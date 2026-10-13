"use client";

import { useMemo, useState } from "react";
import { FrameMockup } from "@/components/FrameMockup";
import { frameFinishes, isFrameFinish, isFrameSize, type FrameFinish } from "@/lib/frames";

type ProductChoice = {
  id: string;
  name: string;
  price: string;
  fulfillment: "digital" | "printful";
  sizes: { id: string; label: string }[];
};

export function CheckoutForm({
  designId,
  productId,
  sizeId,
  frameId,
  imageUrl,
  products,
  mock,
}: {
  designId: string;
  productId: string;
  sizeId: string;
  frameId: string;
  imageUrl: string;
  products: ProductChoice[];
  mock: boolean;
}) {
  const [product, setProduct] = useState(productId);
  const chosen = useMemo(() => products.find((item) => item.id === product) ?? products[0], [product, products]);
  const [size, setSize] = useState(chosen.sizes.some((item) => item.id === sizeId) ? sizeId : chosen.sizes[0].id);
  const [frame, setFrame] = useState<FrameFinish>(isFrameFinish(frameId) ? frameId : "black");
  const framed = chosen.id === "framed";
  const frameSize = isFrameSize(size) ? size : "11x14";
  return (
    <form className="form-card checkout-layout" action="/api/checkout" method="post">
      <div className="checkout-art">
        {framed ? (
          <FrameMockup finish={frame} size={frameSize} label="Your portrait in the selected frame">
            <img src={imageUrl} alt="" />
          </FrameMockup>
        ) : (
          <img src={imageUrl} alt="Preview of the portrait about to be ordered" />
        )}
      </div>
      <div className="checkout-fields">
      <input type="hidden" name="designId" value={designId} />
      {framed ? <input type="hidden" name="frameId" value={frame} /> : null}
      <p className="note">{mock ? "Test checkout. No card is charged, and a printed order is recorded as a mock Printful job." : "You will continue to Stripe’s secure payment page."}</p>
      <label className="field">
        <span>Email</span>
        <input name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
      </label>
      <fieldset>
        <legend>Format</legend>
        <div className="choice-row">
          {products.map((item) => (
            <label key={item.id}>
              <input
                type="radio"
                name="productId"
                value={item.id}
                checked={product === item.id}
                onChange={() => {
                  setProduct(item.id);
                  const preferred = item.id === "framed" && item.sizes.some((size) => size.id === "11x14") ? "11x14" : item.sizes[0].id;
                  setSize(preferred);
                }}
              />
              <span>{item.name} · {item.price}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="field">
        <span>Size</span>
        <select name="sizeId" value={size} onChange={(event) => setSize(event.target.value)}>
          {chosen.sizes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      {framed ? (
        <fieldset>
          <legend>Frame</legend>
          <div className="choice-row">
            {frameFinishes.map((item) => (
              <label key={item.id}>
                <input type="radio" name="frameChoice" checked={frame === item.id} onChange={() => setFrame(item.id)} />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {chosen.fulfillment === "printful" && mock ? (
        <>
          <h2>Ship to</h2>
          <label className="field"><span>Name</span><input name="name" required autoComplete="name" /></label>
          <label className="field"><span>Address</span><input name="address1" required autoComplete="address-line1" /></label>
          <label className="field"><span>Apartment, suite</span><input name="address2" autoComplete="address-line2" /></label>
          <label className="field"><span>City</span><input name="city" required autoComplete="address-level2" /></label>
          <label className="field"><span>State</span><input name="state" required autoComplete="address-level1" /></label>
          <label className="field"><span>Postal code</span><input name="postal" required autoComplete="postal-code" /></label>
          <label className="field">
            <span>Country</span>
            <select name="country" defaultValue="US" autoComplete="country">
              {["US", "CA", "GB", "AU", "NZ", "IE"].map((code) => <option key={code}>{code}</option>)}
            </select>
          </label>
          <label className="field"><span>Phone</span><input name="phone" type="tel" autoComplete="tel" /></label>
        </>
      ) : chosen.fulfillment === "printful" ? (
        <p className="note">Stripe will ask for the shipping address on the next page. The price includes standard shipping.</p>
      ) : null}
      <button className="btn-gold" type="submit">{mock ? "Continue to test payment" : "Continue to secure payment"}</button>
      <p><a href={`/studio`}>Return to the studio</a></p>
      </div>
    </form>
  );
}
