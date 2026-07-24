# Product overview — ecommerce campaign asset workflow

## Purpose

This project explores a focused workflow for turning one approved product image and a verified commercial brief into a coordinated Campaign Pack. It is intended for ecommerce teams that need consistent assets across common channel formats without repeatedly entering the same facts.

The product emphasizes:

- fidelity to the supplied product;
- exact Traditional Chinese and English commercial text;
- repeatable brand presentation;
- coordinated multi-ratio output;
- private handling of product assets.

## Campaign Pack

A Campaign Pack may contain:

- a 1:1 ecommerce or social visual;
- a 4:5 feed visual;
- a 9:16 story visual;
- Traditional Chinese and/or English caption copy;
- deterministic overlays for product name, price, promotion, CTA, and required claims.

The source product should remain unchanged wherever practical. Generative models may assist with scenes, backgrounds, layout suggestions, and copy, while deterministic code should handle exact text and product-preserving composition.

## User workflow

1. Authenticate and enter an authorized workspace.
2. Upload an image the user is entitled to use commercially.
3. Enter verified product facts and brand guidance.
4. Choose a bounded campaign intent or preset.
5. Generate structured scene, layout, and copy suggestions.
6. Compose the approved product and exact overlays.
7. Review coordinated formats and download the selected assets.

## Design principles

- Prefer structured inputs over unrestricted prompting.
- Keep provider-specific behavior behind stable interfaces.
- Make exact commercial text deterministic and reviewable.
- Preserve original assets and derive working copies without overwriting them.
- Keep generated and uploaded assets private by default.
- Record technical quality signals without committing customer, pricing, or operational data.
- Treat accessibility, privacy, authorization, abuse prevention, and deletion workflows as product requirements.

## Scope boundaries

The repository focuses on the Campaign Pack workflow. A general design canvas, bulk catalog import, direct ad publishing, broad social automation, and complex organization workflows are outside the core scope unless they become independently justified.

## Public repository boundary

Public documentation may describe architecture, interfaces, local development, testing, and security principles. It must not include account-specific infrastructure identifiers, customer or cohort details, internal launch plans, commercial assumptions, financing material, or provider-selection plans.
