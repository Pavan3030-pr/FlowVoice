export class RequestManager {
  private generation = 0;

  startRequest(): number {
    this.generation++;

    console.log(`🟢 New request started: Generation ${this.generation}`);

    return this.generation;
  }

  interrupt(): number {
    this.generation++;

    console.log(`🛑 Request interrupted: Generation ${this.generation}`);

    return this.generation;
  }

  isCurrent(requestGeneration: number): boolean {
    return requestGeneration === this.generation;
  }

  getCurrentGeneration(): number {
    return this.generation;
  }
}