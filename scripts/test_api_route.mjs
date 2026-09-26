import { POST } from "../src/app/api/lol/edit/route.ts";

async function testApi() {
  console.log("=== TESTING /api/lol/edit ROUTE ===");
  const req = {
    json: async () => ({
      championId: "aatrox",
      prompt: "Add glowing golden demonic horns to Aatrox's head and infernal spikes on his shoulders."
    })
  };

  const response = await POST(req);
  const data = await response.json();
  console.log("Status:", response.status);
  console.log("Response:", data);
}

testApi().catch(console.error);
