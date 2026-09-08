export interface Restaurant {
  name: string;
  city: string;
  cuisine: string;
  price: number;
}

export async function searchRestaurants(
  city: string,
  query: string
): Promise<Restaurant[]> {
  console.log(
    `🍽️ Searching restaurants in ${city} for "${query}"...`
  );

  const restaurants: Restaurant[] = [
    {
      name: "Spice Garden",
      city,
      cuisine: "Indian",
      price: 600,
    },
    {
      name: "Urban Tadka",
      city,
      cuisine: "North Indian",
      price: 750,
    },
    {
      name: "The Food Street",
      city,
      cuisine: "Multi-cuisine",
      price: 500,
    },
  ];

  console.log(
    `✅ Restaurant search completed for ${city}`
  );

  return restaurants;
}