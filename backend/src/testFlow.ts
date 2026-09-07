import { RequestManager } from "./state/RequestManager";
import { searchHotels } from "./tools/hotel";

const manager = new RequestManager();

async function runHotelSearch(
  city: string,
  generation: number
) {
  console.log(
    `\n🔎 Starting search for ${city} | Generation ${generation}`
  );

  const hotels = await searchHotels(city);

  if (!manager.isCurrent(generation)) {
    console.log(
      `\n❌ STALE RESULT DISCARDED: ${city} | Generation ${generation}`
    );

    return;
  }

  console.log(
    `\n✅ CURRENT RESULT ACCEPTED: ${city} | Generation ${generation}`
  );

  console.log(hotels);
}

async function test() {
  console.log("\n=== FLOWVOICE STALE RESULT TEST ===\n");

  // User asks for Hyderabad
  const hyderabadGeneration = manager.startRequest();

  runHotelSearch("Hyderabad", hyderabadGeneration);

  // Wait 1 second, then simulate user interruption
  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log(
    "\n🗣️ USER INTERRUPTS: Actually, search Bangalore instead!"
  );

  const bangaloreGeneration = manager.interrupt();

  runHotelSearch("Bangalore", bangaloreGeneration);

  // Wait long enough for both searches to finish
  await new Promise((resolve) => setTimeout(resolve, 6000));

  console.log("\n=== TEST COMPLETE ===\n");
}

test();