import { RequestManager } from "./RequestManager";

const manager = new RequestManager();

console.log("\n=== FLOWVOICE REQUEST TEST ===\n");

const request1 = manager.startRequest();

console.log(`Request 1 generation: ${request1}`);
console.log(
  `Is Request 1 current? ${manager.isCurrent(request1)}`
);

const request2 = manager.interrupt();

console.log(`Request 2 generation: ${request2}`);
console.log(
  `Is Request 1 current? ${manager.isCurrent(request1)}`
);
console.log(
  `Is Request 2 current? ${manager.isCurrent(request2)}`
);

console.log("\n=== TEST COMPLETE ===\n");