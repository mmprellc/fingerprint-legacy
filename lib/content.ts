export type Occasion = {
  slug: string;
  title: string;
  kicker: string;
  lede: string;
  paragraphs: string[];
  lines: string[];
  honoree: string;
  script: string;
  sample: "loop" | "whorl";
  couple?: boolean;
};

export const occasions: Occasion[] = [
  {
    slug: "memorials",
    title: "Memorials & tributes",
    kicker: "For a life that should stay close",
    lede: "A reverent portrait for a service, a mantel, or a grandchild who will want to know the shape of a hand they barely held.",
    paragraphs: [
      "Bring a fingerprint from an ink card, a glass, a letter, or a print taken with care. The studio follows the real ridges. You supply the words that only the family knows.",
      "Names of children, the town they never left, a verse, a date, the work of ordinary days. From across the room it is their print. Come closer and it is their story.",
    ],
    lines: [
      "Margaret Hale",
      "1942",
      "2019",
      "mother of James and Elise",
      "the yellow house on Kearney",
      "Sunday hymns",
      "teacher",
      "gardener",
      "she stayed",
    ],
    honoree: "Margaret Hale",
    script: "Always with you.",
    sample: "loop",
  },
  {
    slug: "retirement",
    title: "Retirement gifts",
    kicker: "For a life of service",
    lede: "A distinguished piece for police, fire, military, teachers, and pastors. The print is theirs. The words are the years.",
    paragraphs: [
      "Service leaves a mark you can see. A badge number, a station, a classroom, a parish, the names of people who were kept safe or taught or walked through a hard season.",
      "Give the print and the record of the work. The portrait is made without a committee and without anyone retouching it by hand.",
    ],
    lines: [
      "Captain Elias Ward",
      "Engine 12",
      "thirty-one years",
      "the night shift",
      "Harbor Street",
      "he went in first",
      "coach",
      "father of Ruth and Sam",
      "home for supper",
    ],
    honoree: "Elias Ward",
    script: "Well done.",
    sample: "whorl",
  },
  {
    slug: "weddings",
    title: "Weddings & anniversaries",
    kicker: "Two prints, one story",
    lede: "Intertwined fingerprints, formed from vows, a date, and the particular way two people have spent their days.",
    paragraphs: [
      "Upload both prints. The studio keeps each ridge pattern intact and lays one beside the other, slightly overlapped, so the pair reads as a single piece.",
      "Use the vows, the place you stood, the song, the children who came later. Each print carries its own words.",
    ],
    lines: ["Elena Voss", "June 14", "the orchard", "I choose you", "your laugh in the kitchen"],
    honoree: "Elena and Jonah",
    script: "June fourteenth",
    sample: "loop",
    couple: true,
  },
  {
    slug: "founders",
    title: "Corporate founders",
    kicker: "A company is a set of fingerprints",
    lede: "A sober tribute shaped by milestones, the first room you rented, and the promises that held.",
    paragraphs: [
      "Founders are often thanked with glass and logos. This is quieter. One person's print, and the words of what they actually built.",
      "The first hire. The year the doors opened. A sentence from the original plan. It ships itself, the way the rest of the work had to.",
    ],
    lines: ["Northline", "founded 1998", "the first workshop", "keep the promise", "the people who stayed"],
    honoree: "Northline",
    script: "From the first mark.",
    sample: "whorl",
  },
];

export function occasionBySlug(slug: string) {
  return occasions.find((occasion) => occasion.slug === slug);
}

export const keepsakes = [
  {
    slug: "jewelry",
    title: "Jewelry",
    lede: "A pendant, a locket, a small disc of metal that sits where a hand used to rest.",
    body: "The portrait is prepared as a round, high-resolution file so it can be placed on jewelry. In this version you can buy the digital file, an archival print, or a framed print. The pendant itself is a catalog slot, ready for a production partner, and is not charged yet.",
  },
  {
    slug: "urns",
    title: "Urns",
    lede: "Some families want the print where they keep what remains.",
    body: "An urn medallion uses the same ridge portrait as the print on the wall. You can make that portrait now and download it, or order it on paper. Urn production is structured in the catalog and is not yet a checkout item.",
  },
  {
    slug: "custom",
    title: "Custom keepsakes",
    lede: "The object can change. The portrait is the constant.",
    body: "A bookplate, a stone, a small frame for a desk. Custom objects are listed so they can be attached to production later. Today the studio sells the artwork as a file, an archival print, or a framed print, made entirely by you.",
  },
];

export function keepsakeBySlug(slug: string) {
  return keepsakes.find((item) => item.slug === slug);
}

export type GalleryPiece = {
  slug: string;
  title: string;
  image: string;
  occasion: string;
  caption: string;
  couple: boolean;
  studio?: string;
  pdf?: string;
  compare?: string;
  closeup?: string;
};

export const galleryPieces: GalleryPiece[] = [
  {
    slug: "randy-czyz",
    title: "Randy Czyz",
    image: "/pieces/randy-czyz.png",
    occasion: "memorials",
    caption: "Randy Czyz's own ink print, carrying the family and four verses. Two dedications sit in the core.",
    couple: false,
    studio: "/studio?piece=randy-czyz",
    pdf: "/pieces/randy-czyz.pdf",
    compare: "/pieces/randy-czyz-compare.png",
    closeup: "/pieces/randy-czyz-closeup.png",
  },
  {
    slug: "memorial",
    title: "Margaret Hale",
    image: "/gallery/memorial.png",
    occasion: "memorials",
    caption: "A loop, read from an inked print. Every ridge is a line of her life.",
    couple: false,
  },
  {
    slug: "retirement",
    title: "Elias Ward",
    image: "/gallery/retirement.png",
    occasion: "retirement",
    caption: "A whorl carried in slate, for a career of nights on the engine.",
    couple: false,
  },
  {
    slug: "wedding",
    title: "Elena and Jonah",
    image: "/gallery/wedding.png",
    occasion: "weddings",
    caption: "Two patterns, overlapped. Each print keeps its own words.",
    couple: true,
  },
  {
    slug: "founder",
    title: "Northline",
    image: "/gallery/founder.png",
    occasion: "founders",
    caption: "Gold on ivory. Milestones set into the founder's own lines.",
    couple: false,
  },
];

export function galleryBySlug(slug: string) {
  return galleryPieces.find((piece) => piece.slug === slug);
}

export const steps = [
  {
    n: "01",
    title: "Upload the print",
    body: "Use a photo, a scan, or the camera on your phone. An inked card is ideal. A clear print on glass or paper works too.",
  },
  {
    n: "02",
    title: "Give it words",
    body: "Children, places, verses, dates, the work of a life. Add as many lines as you need. They are laid along the real ridges, not in a circle around them.",
  },
  {
    n: "03",
    title: "Shape the piece",
    body: "Watch the words settle into the loops and whorls. Choose a color, a typeface, a size. Add a second print if this is for two people.",
  },
  {
    n: "04",
    title: "Receive it",
    body: "Pay, and the files are ready. An archival or framed print is sent to the press with your address. No one on our side touches the order.",
  },
];

export const sentiments = [
  {
    quote: "I wanted the grandchildren to see her hand, not a photograph of a photograph.",
    name: "Example, for a daughter",
  },
  {
    quote: "From the doorway it is his print. At the glass, it is the names of the crew.",
    name: "Example, for a retirement",
  },
  {
    quote: "We used the vows. You can read them if you are willing to stand close.",
    name: "Example, for a wedding",
  },
];
