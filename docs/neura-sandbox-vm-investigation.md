# Neura Sandbox And VM Investigation

## Goal

Define the next-step isolation plan after local Standard Mode is stable, without
blocking the current Electron/TypeScript product.

## Current State

Neura V1 runs on the local machine with three practical execution surfaces:

- embedded browser
- local terminal/native tools
- local desktop automation

This is the correct short-term choice because the product still needs
deterministic routing, source-backed research, and stable UI output.

## Why Not Switch To VM/RDP First

Moving immediately to VM/RDP/microVM would increase complexity in the parts of
the app that are already unstable:

1. Session lifecycle
2. file/workspace synchronization
3. takeover latency
4. browser/session continuity
5. packaging and operational support

At this stage, those costs would slow delivery more than they would improve user
outcomes.

## Recommended Phase Order

### Phase A: keep local Standard Mode stable

Must already be true before remote isolation work starts:

- task isolation works
- browser research is source-backed
- shell/native tools are deterministic
- final answers render cleanly
- approvals and diagnostics behave predictably

### Phase B: define a remote provider contract

Target abstraction:

```ts
type ComputerProvider = {
  start(): Promise<void>;
  stop(): Promise<void>;
  getRuntimeState(): Promise<unknown>;
  sendInput(event: unknown): Promise<void>;
  captureFrame(): Promise<string | null>;
};
```

Providers can then be implemented incrementally:

- `local_embedded_browser`
- `local_terminal`
- `local_desktop`
- future `remote_vm`

### Phase C: evaluate isolation strategies

#### Option 1: managed remote Windows/RDP
- Best for “real desktop” parity
- Highest infrastructure and orchestration cost

#### Option 2: Linux microVM/container + browser tooling
- Best for browser/research/coding tasks
- Weaker parity for Windows desktop app automation

#### Option 3: hybrid
- Keep local desktop for visible Windows apps
- Add remote isolated compute for browser/coding/research jobs

## Recommended Direction

Use a **hybrid model** after local Standard Mode is stable:

1. Keep local embedded browser and local app automation for interactive user
   takeover tasks.
2. Add an optional remote compute provider for high-risk code execution,
   package installation, large research jobs, and persistent project workspaces.

This matches Neura’s product shape better than forcing all tasks into RDP.

## Risks To Solve Before Implementation

- authentication/session transfer
- artifact sync between local and remote workspaces
- secure approval gates for destructive actions
- persistent project memory across providers
- latency and reconnect behavior for takeover

## Conclusion

Phase 6.5 is satisfied by documenting the VM/RDP/microVM direction and keeping
the product on a stable local-first architecture until the orchestration layer
is fully reliable.
