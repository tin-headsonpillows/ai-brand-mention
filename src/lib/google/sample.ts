
import type { Cell, TabMatrix } from "./sheetReader";

/**
 * A demo workbook shaped like a real agency SEO plan: several tabs, the content plan not on the first one, a
 * title and a blank row above its headers, section rows between months - so tab and header detection get tested.
 */
const c = (text: string, link: string | null = null): Cell => ({ text, link });
const row = (...cells: Array<string | Cell>): Cell[] => cells.map((x) => (typeof x === "string" ? c(x) : x));

const PLAN: Cell[][] = [
  row("Content Plan 2026 - Lumen Coast Resort"),
  [],
  row("Month", "Topic", "Title", "Category", "Writer", "Due date", "Priority", "Action", "Content", "Status", "Publish URL"),
  row("October 2026"),
  row("Oct 2026", "best time to visit danang", "The Best Time to Visit Danang, Month by Month", "Travel guides", "Writer A", "2026-09-12", "TRUE", "New", c("Best time to visit Danang", "sample:2"), "Published", "https://lumencoast.example/best-time-to-visit-danang"),
  row("Oct 2026", "danang wedding venue beach", "Planning a Beach Wedding in Danang", "Weddings", "Writer A", "2026-10-18", "TRUE", "New", c("Beach wedding Danang", "sample:0"), "Approved", ""),
  row("Oct 2026", "family resort danang", "A Family Guide to Danang's Beaches", "Family", "Writer B", "2026-10-20", "FALSE", "Revamp", c("Family guide", "sample:1"), "Waiting for client", ""),
  row("Oct 2026", "danang honeymoon resort", "Honeymoon in Danang: 3-Day Itinerary", "Itineraries", "Writer A", "2026-10-24", "TRUE", "New", c("Honeymoon itinerary", "sample:2"), "Internal review", ""),
  row("November 2026"),
  row("Nov 2026", "spa resort danang", "Spa and Wellness at Lumen Coast", "Wellness", "Writer C", "2026-10-28", "FALSE", "New", "", "Writing", ""),
  row("Nov 2026", "danang airport to beach", "Getting from Danang Airport to the Beach", "Travel guides", "Writer B", "2026-11-04", "FALSE", "New", "", "Brief", ""),
  row("Nov 2026", "danang seafood restaurant", "Seafood near My Khe Beach", "Food", "Writer C", "2026-11-08", "FALSE", "New", "", "", ""),
  row("Dec 2026", "my khe beach hotel", "My Khe Beach Hotels: Where to Stay", "Travel guides", "", "2026-11-20", "TRUE", "Revamp", "", "Not started", ""),
];

export const SAMPLE_WORKBOOK: { title: string; tabs: TabMatrix[] } = {
  title: "SEO//GEO Plan - Lumen Coast (sample)",
  tabs: [
    { title: "Access & Tracking Setup", gid: 0, matrix: [row("No.", "Assessment", "Detail", "Accessed"), row("1", "CMS Login", "", "TRUE"), row("2", "GA4", "", "TRUE")] },
    { title: "1. Business Overview", gid: 11, matrix: [row("Business overview"), row("Product", "Resort", "Primary")] },
    { title: "4. Content Plan", gid: 44, matrix: PLAN },
    { title: "Content Audit", gid: 55, matrix: [row("No.", "Topic", "Status", "Topic's Title", "Priority", "Action"), row("1", "https://lumencoast.example/rooms", "OK", "Rooms", "FALSE", "Revamp")] },
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
