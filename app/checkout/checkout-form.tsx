"use client";

import { useMemo, useState } from "react";

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
  products,
  mock,
}: {
  designId: string;
  productId: string;
  sizeId: string;
  products: ProductChoice[];
  mock: boolean;
}) {
  const [product, setProduct] = useState(productId);
  const chosen = useMemo(() => products.find((item) => item.id === product) ?? products[0], [product, products]);
  const [size, setSize] = useState(chosen.sizes.some((item) => item.id === sizeId) ? sizeId : chosen.sizes[0].id);
  return (
    <form className="form-card" action="/api/checkout" method="post">
      <input type="hidden" name="designId" value={designId} />
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
                  setSize(item.sizes[0].id);
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
    </form>
  );
}
