/** Minimal Web Audio fakes for node tests (no real audio; records what the mixer does). */
export class FakeParam {
  value: number;
  constructor(v = 0) {
    this.value = v;
  }
  setTargetAtTime(v: number) {
    this.value = v;
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}

export class FakeNode {
  connected = 0;
  /** Nodes connected to (connect(node) targets; disconnect(node) removes one). */
  targets: unknown[] = [];
  connect(to?: unknown) {
    this.connected++;
    this.targets.push(to);
    return this;
  }
  disconnect(to?: unknown) {
    if (to === undefined) {
      this.connected = 0;
      this.targets = [];
      return;
    }
    const i = this.targets.indexOf(to);
    if (i < 0) throw new Error("InvalidAccessError: not connected");
    this.targets.splice(i, 1);
    this.connected--;
  }
}

export class FakeOscillator extends FakeNode {
  type = "sine";
  frequency = new FakeParam(440);
  started = 0;
  stopped = 0;
  start() {
    this.started++;
  }
  stop() {
    this.stopped++;
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

export class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  playbackRate = new FakeParam(1);
  started = 0;
  startArgs: number[] = [];
  stopped = 0;
  onended: (() => void) | null = null;
  start(...args: number[]) {
    this.started++;
    this.startArgs = args;
  }
  stop() {
    this.stopped++;
  }
}

export class FakeAudioContext extends EventTarget {
  state: "running" | "suspended" | "closed" | "interrupted" = "suspended";
  currentTime = 0;
  destination = new FakeNode();
  /** resume() rejects (no user gesture yet, iOS "interrupted"). */
  resumeBlocked = false;
  resumes = 0;
  suspends = 0;
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  /** Every node created (any kind), for build-nothing checks. */
  created = 0;
  oscillators: FakeOscillator[] = [];
  decoded: ArrayBuffer[] = [];
  /** decodeAudioData result per call (default: a buffer of `length` frames at 48 kHz). */
  decode: (data: ArrayBuffer) => Promise<unknown> = async (data) => ({ length: 48000, sampleRate: 48000, duration: 1, numberOfChannels: 1, bytes: data.byteLength });
  setState(s: FakeAudioContext["state"]) {
    if (this.state === s) return;
    this.state = s;
    this.dispatchEvent(new Event("statechange"));
  }
  async resume() {
    this.resumes++;
    if (this.state === "closed") throw new Error("InvalidStateError");
    if (this.resumeBlocked) throw new Error("NotAllowedError");
    this.setState("running");
  }
  async suspend() {
    this.suspends++;
    if (this.state === "closed") throw new Error("InvalidStateError");
    this.setState("suspended");
  }
  async close() {
    this.setState("closed");
  }
  createGain() {
    this.created++;
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource() {
    this.created++;
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createBiquadFilter() {
    this.created++;
    return Object.assign(new FakeNode(), { type: "", frequency: new FakeParam(350) });
  }
  createDelay() {
    this.created++;
    return Object.assign(new FakeNode(), { delayTime: new FakeParam(0) });
  }
  createOscillator() {
    this.created++;
    const o = new FakeOscillator();
    this.oscillators.push(o);
    return o;
  }
  async decodeAudioData(data: ArrayBuffer) {
    this.decoded.push(data);
    return this.decode(data);
  }
}

/** Let queued promise callbacks run. */
export const flush = () => new Promise((r) => setTimeout(r, 0));
