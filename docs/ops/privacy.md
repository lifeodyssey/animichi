# Privacy and evaluation data handling

This is the operational companion to the user-facing [privacy policy](/privacy). It
records the boundary that any evaluation or service-improvement pipeline must keep
before it is enabled for production traffic.

## User-facing promise

- Conversations, tool results, uploaded images, and location data contained in them
  may be sampled for evaluation and service improvement, with a maximum retention of
  365 days.
- The active policy version is recorded at collection time. The current S0.6 copy is
  `2026-08-02` in all three dictionaries.
- A thumbs-up or thumbs-down action is product feedback; it is never treated as
  consent to use private content.

## Required collection boundary

1. Build the evaluation candidate from the already typed, redacted event model, not
   from raw request headers or an exception object.
2. Hard-exclude API keys, `Authorization`, `Cookie`, magic-link URLs, access tokens,
   and any equivalent bearer/session credential before persistence or telemetry.
3. Record `privacy_policy_version` alongside a candidate at collection time. Keep the
   retention deadline no later than 365 days and delete rejected candidates
   immediately.
4. After credential scrubbing, encrypt any retained raw payload with AES-256-GCM
   using an environment-held secret. The key is an operator secret, never a payload
   field, fixture literal, log value, or client-visible variable.
5. Formal evaluation fixtures require a human de-identification pass and an explicit
   write step. Production traffic and feedback must never auto-write fixtures.

## S0.6 boundary

The landing/login slice only publishes the notice and its versioned copy; it does
not create an evaluation collector. A future collector may not be enabled until it
proves the boundary above with unit/integration tests and a deletion/retention probe.
The live Neon Auth provider, encryption secret, and production retention job remain
deployment/operator responsibilities and are not verified by this staging change.
