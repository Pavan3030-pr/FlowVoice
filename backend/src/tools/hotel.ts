export interface Hotel {
  name: string;
  city: string;
  price: number;
}

export async function searchHotels(city: string): Promise<Hotel[]> {
  console.log(`🔎 Searching hotels in ${city}...`);

  // Simulate a slow external API
  await new Promise((resolve) => setTimeout(resolve, 5000));

  const hotels: Hotel[] = [
    {
      name: "Grand Central Hotel",
      city,
      price: 4200,
    },
    {
      name: "City View Inn",
      city,
      price: 3500,
    },
    {
      name: "Comfort Stay",
      city,
      price: 2800,
    },
  ];

  console.log(`✅ Hotel search completed for ${city}`);

  return hotels;
}