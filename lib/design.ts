import { z } from "zod";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const designSchema = z.object({
  sizeId: z.enum(["8x10", "11x14", "16x20"]),
  formatId: z.enum(["digital", "archival", "framed"]),
  fontId: z.enum(["garamond", "garamond-italic", "cinzel", "eb-garamond"]),
  ink: hex,
  ink2: hex.optional(),
  background: hex,
  density: z.number().min(0.75).max(1.45),
  tracking: z.number().min(-0.02).max(0.16),
  caption: z.string().max(140).optional(),
  invert: z.enum(["auto", "yes", "no"]),
  prints: z
    .array(
      z.object({
        imageDataUrl: z.string().min(32).max(9_000_000),
        phrases: z.array(z.string().max(180)).max(24),
      }),
    )
    .min(1)
    .max(2),
});

export type DesignInput = z.infer<typeof designSchema>;

export const checkoutSchema = designSchema.extend({
  email: z.string().trim().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
  customerName: z.string().trim().min(2).max(80),
  shipping: z
    .object({
      name: z.string().trim().min(2).max(80),
      address1: z.string().trim().min(3).max(120),
      address2: z.string().trim().max(120).optional(),
      city: z.string().trim().min(2).max(80),
      state: z.string().trim().min(2).max(40),
      postal: z.string().trim().min(3).max(16),
      country: z.string().trim().regex(/^[A-Z]{2}$/),
      phone: z.string().trim().max(24).optional(),
    })
    .optional(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export type ShippingAddress = NonNullable<CheckoutInput["shipping"]>;
