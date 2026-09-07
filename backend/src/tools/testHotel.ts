import { searchHotels } from "./hotel";

async function test() {
  console.log("\n=== HOTEL TOOL TEST ===\n");

  const start = Date.now();

  const hotels = await searchHotels("Hyderabad");

  const elapsed = Date.now() - start;

  console.log("\nResults:");

  for (const hotel of hotels) {
    console.log(
      `${hotel.name} | ${hotel.city} | ₹${hotel.price}`
    );
  }

  console.log(`\nTime taken: ${elapsed} ms`);

  console.log("\n=== TEST COMPLETE ===\n");
}

test();