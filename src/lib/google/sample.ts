import type { SheetPreview } from "../articles/types";

/** A demo content plan + Docs, so the import → edit → publish flow can be tried before Google sign-in is set up. */
export const SAMPLE_SHEET: Omit<SheetPreview, "mapping"> = {
  spreadsheetId: "sample",
  title: "Sample content plan",
  tabs: [{ title: "Q4 articles", gid: 0 }],
  tab: "Q4 articles",
  via: "sample",
  headers: ["Article title", "Focus keyword", "Secondary keywords", "Google Doc", "Category", "Tags", "Publish date", "Status"],
  rows: [
    {
      rowNumber: 2,
      cells: ["Best Beachfront Hotels in Da Nang for a First Visit", "beachfront hotels in Da Nang", "My Khe beach hotel, Da Nang resort", "Draft v2", "Travel guides", "Da Nang, beach, hotels", "2026-10-20", "Ready"],
      links: [null, null, null, "sample:0", null, null, null, null],
    },
    {
      rowNumber: 3,
      cells: ["Hoi An Day Trip from Da Nang: A Simple Itinerary", "Hoi An day trip", "Da Nang to Hoi An, Hoi An old town", "Draft", "Itineraries", "Hoi An, day trip", "2026-10-27", "In review"],
      links: [null, null, null, "sample:1", null, null, null, null],
    },
    {
      rowNumber: 4,
      cells: ["When to Visit Da Nang: Weather Month by Month", "best time to visit Da Nang", "Da Nang weather, Da Nang rainy season", "Draft", "Travel guides", "Da Nang, weather", "2026-11-03", "Writing"],
      links: [null, null, null, "sample:2", null, null, null, null],
    },
  ],
};

export const SAMPLE_DOCS: Array<{ title: string; html: string }> = [
  {
    title: "Best Beachfront Hotels in Da Nang for a First Visit",
    html: `<p>Da Nang's coastline runs for more than 30 kilometres, and most visitors want a room within a few steps of the sand. This guide compares the beachfront hotels in Da Nang that suit a first visit, from family resorts to design-led boutique stays.</p>
<h2>Why stay on the beach in Da Nang</h2>
<p>My Khe beach is long, clean and lifeguarded for most of the year. Staying on Vo Nguyen Giap street puts you across the road from the water, close to seafood restaurants, and about 15 minutes from the airport.</p>
<h2>How we chose these hotels</h2>
<p>We looked at recent guest reviews, how far each room is from the water, breakfast quality, and whether the pool is usable when the sea is rough between October and December.</p>
<h3>Family-friendly resorts</h3>
<p>Resorts on the Son Tra peninsula and in Ngu Hanh Son have kids' clubs, shallow pools and private beach sections. They are quieter but further from the city's restaurants.</p>
<h3>City-centre beach hotels</h3>
<p>Tower hotels along My Khe give sea views at lower prices. Ask for a high floor facing east for sunrise over the water.</p>
<h2>Booking tips</h2>
<ul><li>Book three to four weeks ahead for June to August.</li><li>Choose free cancellation in the rainy season.</li><li>Check whether the hotel crosses the road to a private beach area or uses the public beach.</li></ul>
<p>Planning more of central Vietnam? A day trip to Hoi An is easy from any of these hotels.</p>`,
  },
  {
    title: "Hoi An Day Trip from Da Nang: A Simple Itinerary",
    html: `<p>Hoi An's old town is 30 kilometres south of Da Nang, close enough for an easy day trip. Here is a simple plan that avoids the midday heat and the evening crowds on the bridge.</p>
<h2>Getting from Da Nang to Hoi An</h2>
<p>A ride-hailing car takes about 45 minutes. Shared shuttles leave from most beach hotels in the morning. Motorbike rental works if you are confident in traffic.</p>
<h2>Morning: the old town before the crowds</h2>
<p>Arrive by 8am. Buy the old town ticket, visit the Japanese Covered Bridge and two assembly halls, then stop for a coffee by the river.</p>
<h2>Afternoon: tailors, food and the beach</h2>
<p>Order clothes early so a fitting fits into the same day. After lunch, An Bang beach is ten minutes away by taxi.</p>
<h2>Evening: lanterns on the river</h2>
<ol><li>Walk the night market after 6pm.</li><li>Take a short boat ride with a paper lantern.</li><li>Head back to Da Nang by 9pm to beat the traffic.</li></ol>`,
  },
  {
    title: "When to Visit Da Nang: Weather Month by Month",
    html: `<p>Da Nang has a dry season from February to August and a rainy season from September to January. The best time to visit depends on whether you want beach days, lower prices or festivals.</p>
<h2>February to May: the sweet spot</h2>
<p>Warm days, calm sea and fewer crowds than summer. This is the best time to visit Da Nang for most travellers.</p>
<h2>June to August: peak beach season</h2>
<p>Hot and sunny, with domestic holidaymakers filling hotels. Book early and plan indoor breaks at midday.</p>
<h2>September to January: rain and storms</h2>
<p>Heavy rain and occasional typhoons, especially in October and November. Prices drop, and the city is greener, but beach days are not guaranteed.</p>
<table><tbody><tr><th>Month</th><th>Average high</th><th>Rain</th></tr><tr><td>April</td><td>30°C</td><td>Low</td></tr><tr><td>July</td><td>34°C</td><td>Low</td></tr><tr><td>October</td><td>28°C</td><td>Very high</td></tr></tbody></table>`,
  },
];
