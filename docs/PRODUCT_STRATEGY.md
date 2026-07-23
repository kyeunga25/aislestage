# Product strategy — ecommerce campaign asset workflow

This document replaces application-driven planning with a product-evidence plan. The current `Motive` name is a working codename, not a final public brand.

## 1. Product thesis

Small ecommerce teams do not need another open-ended image generator. They need a repeatable way to turn an existing product photo, verified product facts, and a small brand brief into channel-ready campaign assets without retyping the same information or fixing invented claims.

The product should win on:

- product fidelity;
- exact Traditional Chinese and English commercial text;
- repeatable brand presentation;
- fast multi-ratio output;
- lower revision effort than a generic image or design tool.

The product should not compete on unrestricted prompting or on having the largest editing canvas.

## 2. What is proven and what is still assumed

Proven in the repository:

- A React/Vite interface can collect product and brand inputs.
- Five ecommerce output concepts have been prototyped.
- The Worker architecture can use D1, private R2, Queues, and swappable AI providers.
- Auth, workspace scoping, generation history, and private output serving are in local work-in-progress.
- The project type-checks, builds, and can be packaged for Cloudflare Workers.

Still unproven:

- merchants will prefer this workflow to Canva, agency templates, or distributor assets;
- generated outputs preserve the exact product well enough for commercial use;
- merchants will repeatedly use all five proposed workflows;
- the time saved is large enough to support a paid subscription;
- electronics merchants are the best first segment rather than only a convenient demo segment.

Product work should now maximize evidence about these assumptions.

## 3. Initial customer and use case

Initial customer profile:

- a Hong Kong ecommerce merchant or small marketing team;
- publishes promotions at least several times per month;
- already has a usable product photo and verified product information;
- needs Traditional Chinese, English, or both;
- currently edits templates manually or outsources small creative jobs.

Electronics and DIY PC merchants remain a candidate design-partner segment, not a confirmed market choice. Their high SKU turnover and specification-heavy promotions are attractive, but exact logos, packaging, prices, and hardware details make fidelity especially demanding.

## 4. Narrow MVP outcome

The first validated outcome is one **Campaign Pack**:

> Turn one approved product image and a short commercial brief into a coherent set of sale-ready visual assets and copy.

Initial pack:

- one 1:1 ecommerce/social visual;
- one 4:5 feed advertisement;
- one 9:16 story visual;
- one Traditional Chinese and/or English caption;
- deterministic text overlays for product name, price, promotion, CTA, and required claims.

The source product should remain unchanged wherever possible. The image model may create or edit the scene and background, but should not be trusted to redraw exact product geometry, packaging text, logos, prices, or specifications. Product cutout/compositing and text rendering should use deterministic code.

The former five workflows remain useful research inputs, but they are not five equal MVP products. Detail banners and packaging showcases should return only after the Campaign Pack meets its quality and repeat-use gates.

## 5. MVP user journey

1. Sign in through the closed-beta entry point.
2. Upload one clean product reference image.
3. Enter verified product facts, price, promotion, locale, brand colors, tone, and CTA.
4. Choose a campaign intent or preset instead of writing a free-form prompt.
5. Generate a small number of scene/layout directions.
6. Compose the untouched product asset and deterministic text onto selected directions.
7. Review all ratios together, copy the caption, and download the pack.
8. Record whether each output was usable, what needed correction, and whether the merchant would use it again.

## 6. Build priorities

### Priority A — stabilize the current local foundation

- Review and finish the uncommitted auth/session/workspace work.
- Add automated tests for session, workspace isolation, credit reservation, and duplicate queue delivery.
- Apply migrations locally before any remote migration.
- Do not deploy the work-in-progress until the local checks and authorization tests pass.

### Priority B — build the truth-generating workflow

- Implement authenticated product image upload to private R2.
- Preserve an original object and create a normalized working asset.
- Make the image provider use the reference asset or a compositing-safe background workflow.
- Add deterministic multi-ratio composition and exact text overlays.
- Replace the demo copy/result panel with real structured results and polling.
- Record provider usage, latency, failure reason, and estimated cost per successful pack.

### Priority C — run a concierge beta

- Recruit 5 design partners rather than opening public signup.
- Process at least 2 real products per partner.
- Observe the current manual workflow before showing the product.
- Capture permissioned before/after examples and structured feedback.
- Manually assist failed generations so the team learns why they fail.

### Priority D — invest only after repeat-use evidence

- Persist reusable brand packs and product libraries when merchants repeat.
- Add generation history, regenerate, and duplicate-project actions.
- Introduce pricing and payment only after willingness-to-pay and cost evidence exist.
- Add more workflows only when requested by multiple design partners.

## 7. Validation gates

Before expanding the product, target all of the following:

- at least 5 relevant design partners complete a real-product trial;
- at least 10 distinct products are processed;
- at least 70% of selected outputs are usable with no more than minor edits;
- median time from input to first usable Campaign Pack is under 10 minutes;
- at least 3 partners return with another product or campaign within 14 days;
- at least 3 partners give a concrete acceptable price or agree to a paid pilot;
- product-fidelity and exact-text failures are separately measured;

If fidelity or repeat use misses these gates, do not compensate by adding more features. Narrow the product type, improve deterministic composition, or change the first customer segment.

## 8. Explicitly deferred

- public self-serve launch;
- Wonder payment integration;
- credit packs and complex plan management;
- multi-user workspace roles beyond what closed beta requires;
- arbitrary canvas editing;
- direct ad publishing and social posting;
- Shopify or WooCommerce OAuth import;
- CSV bulk generation;
- agency and enterprise approval workflows;
- additional markets and languages beyond Traditional Chinese and English.

## 9. Branding boundary

Keep infrastructure identifiers such as the Worker, D1 database, R2 bucket, and queue unchanged until a final brand has passed company-name, trademark, domain, and customer-language checks. A public rename should be a separate, deliberate migration rather than part of product validation.
