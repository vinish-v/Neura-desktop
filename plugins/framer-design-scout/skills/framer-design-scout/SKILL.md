---
name: framer-design-scout
description: Use when designing, redesigning, or improving frontend UI by researching live Framer Marketplace templates, components, and vectors for the current project, then adapting the strongest ideas into original code without copying templates or assets verbatim.
---

# Framer Design Scout

Use this skill when a user asks Codex to improve a frontend with Framer inspiration, find Framer templates/components/vectors, or make an existing project feel more polished by using current Framer Marketplace references.

## Core Rules

- Start from the existing project. Inspect its stack, routes, components, design tokens, copy, data flow, and constraints before researching inspiration.
- Use live web research for Framer resources. Prefer official Framer Marketplace pages before third-party roundups.
- Do not copy templates, component source, vectors, brand systems, screenshots, or paid assets verbatim.
- Treat Framer resources as references for patterns: layout rhythm, density, motion, interaction, spacing, visual hierarchy, component behavior, icon direction, and asset style.
- Produce original implementation work that fits the current app, its framework, and its existing design language.
- Do not introduce fake data, mock services, hardcoded product claims, or placeholder assets into production code.
- Respect licenses and access. If a resource is paid, locked, or unclear, cite it as inspiration only and create an original equivalent.

## Workflow

1. Project scan
   - Run `scripts/inspect_frontend_project.py` from this plugin when available.
   - Read the current app's `package.json`, frontend entrypoints, route files, component library, styling setup, and recent UI patterns.
   - Identify the target screen, audience, functional constraints, and existing visual direction.

2. Framer research
   - Search official Framer Marketplace first:
     - `https://www.framer.com/marketplace/`
     - `https://www.framer.com/marketplace/templates/`
     - `https://www.framer.com/marketplace/components/`
     - `https://www.framer.com/marketplace/vectors/`
   - Search with project-specific terms, for example `Framer Marketplace SaaS dashboard template`, `Framer Marketplace AI app component`, or `Framer vectors abstract interface`.
   - Gather a shortlist of 5 to 8 relevant references across templates, components, and vectors when possible.
   - Include links and brief source notes in the design brief.

3. Fit analysis
   - For each candidate, extract only transferable ideas:
     - information architecture
     - grid and spacing system
     - component composition
     - typography scale
     - motion or interaction idea
     - illustration/vector style direction
     - color/material treatment
   - Reject candidates that conflict with the app's product type, accessibility, performance, licensing, or current design constraints.

4. Spice pass
   - Create an original direction that combines the best patterns with a stronger, project-specific design idea.
   - Change structure, copy rhythm, interaction details, color balance, and component behavior enough that the output is clearly not a clone.
   - Prefer rich but usable product UI: real controls, real states, responsive behavior, accessible contrast, and no decorative clutter.

5. Implementation
   - Use the project's existing framework, components, icons, styling conventions, and state/data APIs.
   - Add assets only when they are original, generated for this project, already licensed in the repo, or loaded from approved external sources.
   - Keep edits scoped to the requested UI surface.
   - Verify with the project's normal checks and browser/UI testing when available.

## Output Shape

When doing design research before implementation, provide:

- `Project read`: the stack, target files, and design constraints found locally.
- `Framer shortlist`: links with one-sentence relevance notes.
- `Adaptation plan`: what will be borrowed as ideas and how it will be transformed.
- `Implementation notes`: exact files/components to change.

When implementing directly, keep the final response focused on:

- files changed
- design direction used
- verification performed
- any Framer links that materially influenced the result

## Quality Bar

- The final UI should feel purpose-built for the product, not like a pasted marketplace template.
- The design should preserve product credibility: readable, responsive, accessible, and fast.
- Any Framer reference should be traceable in the reasoning, but not recognizable as a direct copy in the code.
