# Neura Source Extractor Evaluation

## Goal

Keep browser research inside Neura’s embedded browser while leaving room for an
optional scraper backend later.

## Current Runtime Decision

- Default runtime extractor: `EmbeddedBrowserSourceExtractor`
- Runtime status: enabled
- Integration point: `SourceExtractor`
- Current backend selection: `createSourceExtractor()` falls back to the
  embedded extractor for all runtime work

This keeps the browser research loop grounded in the same page/session the user
sees inside Neura’s Computer.

## Why Embedded Browser Is The V1 Default

1. **Shared session state**
   - The agent and the user act on the same in-app browser surface.
   - Login/session/captcha state stays aligned with what the user sees.

2. **Lower architecture risk**
   - No second scraping stack is required just to ship reliable research.
   - The extractor already has access to DOM, readable text, screenshots, and
     navigation state from the embedded Electron browser.

3. **Cleaner task execution**
   - Research tasks can search, open sources, extract readable text, synthesize,
     and validate without switching browser providers mid-run.

## Obscura Evaluation

Repository reviewed: [h4ckf0r0day/obscura](https://github.com/h4ckf0r0day/obscura)

### Useful properties

- CDP-compatible browser automation model
- Potentially useful for headless scraping/extraction workloads
- Could serve as an alternate `SourceExtractor` implementation later

### Why it is not a runtime dependency yet

1. Neura already has a working embedded browser surface.
2. The current V1 problem is orchestration and extraction quality, not the lack
   of a second browser engine.
3. Adding Obscura now would introduce another execution path before the primary
   embedded research path is fully hardened.
4. Windows packaging, dependency footprint, and long-run stability would need
   separate validation.

## Adapter Contract

Neura keeps the backend seam small:

```ts
type SourceExtractor = {
  extractCurrentPage(): Promise<ResearchSource>;
};
```

Backends currently tracked by code:

- `embedded` — default runtime backend
- `obscura_candidate` — evaluation-only, not enabled in runtime

## Exit Criteria For A Future Obscura Adapter

Only add an Obscura-backed implementation if it proves all of the following:

1. Better extraction quality on blocked/ad-heavy article pages
2. Stable Windows packaging and startup behavior
3. No regression in task takeover/user-visible browser continuity
4. Clear test evidence that it improves current research outcomes

## Conclusion

Phase 6.4 is satisfied by keeping the optional scraper backend behind
`SourceExtractor`, documenting the evaluation, and not introducing a blind
runtime dependency.
