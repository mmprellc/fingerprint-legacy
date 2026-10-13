import { FRAMED_POSTER_PRODUCT_ID, framePrintArea, framedVariantId } from "./frames";

export type MockupResult = {
  source: "local" | "printful";
  mockupUrl?: string;
  taskKey?: string;
  error?: string;
};

type TaskPayload = {
  result?: {
    task_key?: string;
    status?: string;
    error?: string;
    mockups?: Array<{ mockup_url?: string; extra?: Array<{ url?: string }> }>;
  };
  error?: { message?: string };
};

function headers() {
  const key = process.env.PRINTFUL_API_KEY || "";
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...(process.env.PRINTFUL_STORE_ID ? { "X-PF-Store-Id": process.env.PRINTFUL_STORE_ID } : {}),
  };
}

export function mockupRequestBody(imageUrl: string, finish: string | undefined, size: string | undefined) {
  const [areaWidth, areaHeight] = framePrintArea(size);
  return {
    variant_ids: [framedVariantId(finish, size)],
    format: "jpg",
    files: [
      {
        placement: "default",
        image_url: imageUrl,
        position: {
          area_width: areaWidth,
          area_height: areaHeight,
          width: areaWidth,
          height: areaHeight,
          top: 0,
          left: 0,
        },
      },
    ],
  };
}

function mockupUrlFrom(payload: TaskPayload) {
  const mockup = payload.result?.mockups?.[0];
  return mockup?.extra?.find((item) => item.url)?.url || mockup?.mockup_url || "";
}

export async function createFramedMockup(imageUrl: string, finish: string | undefined, size: string | undefined): Promise<MockupResult> {
  if (!process.env.PRINTFUL_API_KEY) return { source: "local" };
  if (!/^https:\/\//.test(imageUrl)) return { source: "local", error: "Printful needs a public https image." };
  const response = await fetch(`https://api.printful.com/mockup-generator/create-task/${FRAMED_POSTER_PRODUCT_ID}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(mockupRequestBody(imageUrl, finish, size)),
  });
  const payload = (await response.json().catch(() => null)) as TaskPayload | null;
  if (!response.ok) {
    return { source: "local", error: payload?.error?.message || `Printful returned ${response.status}` };
  }
  const taskKey = payload?.result?.task_key || "";
  if (payload?.result?.status === "completed") {
    const mockupUrl = mockupUrlFrom(payload);
    return mockupUrl ? { source: "printful", mockupUrl, taskKey } : { source: "local", taskKey, error: "Printful finished without an image." };
  }
  if (!taskKey) return { source: "local", error: "Printful did not return a mockup task." };
  const ready = await pollMockup(taskKey);
  return ready.mockupUrl ? { ...ready, source: "printful" as const, taskKey } : { source: "local", taskKey, error: ready.error };
}

export async function pollMockup(taskKey: string): Promise<MockupResult> {
  if (!process.env.PRINTFUL_API_KEY) return { source: "local" };
  if (!/^[\w-]+$/.test(taskKey)) return { source: "local", error: "Unknown mockup task." };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1500));
    const response = await fetch(`https://api.printful.com/mockup-generator/task?task_key=${encodeURIComponent(taskKey)}`, {
      headers: headers(),
    });
    const payload = (await response.json().catch(() => null)) as TaskPayload | null;
    if (!response.ok) return { source: "local", error: payload?.error?.message || `Printful returned ${response.status}` };
    const status = payload?.result?.status;
    if (status === "failed") return { source: "local", error: payload?.result?.error || "Printful could not render the frame." };
    if (status === "completed") {
      const mockupUrl = mockupUrlFrom(payload ?? {});
      return mockupUrl ? { source: "printful", mockupUrl, taskKey } : { source: "local", error: "Printful finished without an image." };
    }
  }
  return { source: "local", taskKey, error: "Printful is still rendering the frame." };
}
