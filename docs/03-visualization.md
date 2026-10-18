# 3. Visualization: showing new siding, windows and doors on the real house

## What's realistic today

Three approaches are proven. They trade off **product accuracy**, **photorealism**, and **speed**:

| Approach | How it works | Real-time? | Photorealism | Product accuracy | Typical cost |
|---|---|---|---|---|---|
| **A. Mask + texture swap** (deterministic) | Segment walls, trim, windows and doors once. Then recolor or re-texture each region with a perspective-correct product swatch, keeping the original shading | ✅ Yes, in the browser (WebGL/canvas) once masks exist | Good for color and siding profile. Weak for changing window *styles* or door designs | **High.** Exact brand colors, real swatches | One-time segmentation per photo (seconds), then near-zero |
| **B. Generative editing** (instruction- or mask-guided diffusion) | "Replace the siding with charcoal board-and-batten; keep everything else" | ❌ Seconds to a minute per image on hosted APIs | **Excellent.** Can swap window grids, door styles, trim | **Unreliable.** May add or remove windows, shift rooflines, invent details. Colors drift from the real product | About $0.01–$0.24 per image depending on model and resolution |
| **C. 3D model + product library** (Hover-style) | Build a measured 3D model from photos, then apply manufacturer products to the model | ✅ Interactive, orbit any angle | Medium (looks rendered, not photographed) | **High.** Tied to the measured model and real SKUs | Bundled with the measurement product |

### What "real-time" means in practice

- **Approach A is real-time today** for color, profile and trim changes. That covers most of the
  "try options" interaction homeowners want.
- **Generative real-time exists in research and enthusiast setups**, not as a dependable product
  feature. TurboEdit (SDXL-Turbo, few-step) reports edits in **under 0.5 s** on an A5000 GPU
  ([arXiv 2408.08332](https://arxiv.org/pdf/2408.08332)). StreamDiffusion reports up to **91 fps**
  on an RTX 4090 ([arXiv 2312.12491](https://arxiv.org/html/2312.12491v2)). A community FLUX.2
  streaming pipeline claims about **0.2–0.3 s at 512×512**
  ([FluxRT](https://github.com/thinhlpg/fluxrt)). In contrast, stock FLUX.1 Kontext at 28 steps took
  **~56 s per edit** on an A6000 in one paper ([arXiv 2510.08532](https://arxiv.org/pdf/2510.08532)).
  Hosted APIs run faster on their own hardware, but they're still seconds, not frames. Real-time
  generative means running your own GPUs at lower resolution and lower consistency. That's not
  worth it until the basics are proven.
- **Practical answer: real-time swatches (A) plus a few pre-rendered "hero" images (B) per
  design.** Generate them asynchronously and email or notify the homeowner when they're ready.

## Tools and APIs to build on

### Buy or partner (fastest)

- **Hover:** 3D models with manufacturer product libraries. Partners include **James Hardie**
  (Hardie Designer: a homeowner uploads one front photo, tries styles, finds a contractor),
  **CertainTeed**, **LP SmartSide**, and **Chelsea Building Products/Everlast** (announced 2026)
  ([Hover × Hardie](https://hover.to/blog/hardie-designer-with-hover),
  [Concrete Products](https://concreteproducts.com/index.php/tag/james-hardie/),
  [HBS Dealer: CertainTeed](https://www.hbsdealer.com/news/certainteed-partners-hovers-3d-platform),
  [Hover × LP](https://hover.to/blog/hover-lp-partner-bring-lp-smartside-products-exterior-contractors-via-hover-platform),
  [Everlast × Hover](https://www.everlastsiding.com/node/455)).
- **Renoworks:** white-label photo visualizers for siding, roofing, windows, doors and stone
  for manufacturers and distributors. Customers reportedly include Alside (Renoworks AI Gen 2),
  Owens Corning, AZEK and Gentek. Custom pricing. I found no public API docs
  ([Stockwatch release, Oct 2025](https://wwww.stockwatch.com/News/Item/Z-C!RW-3747069/C/RW),
  [Alside](https://alside.com/blog/visualize-your-dream-home-with-ai-technology),
  [SoftwareFinder](https://softwarefinder.com/construction/renoworks)).
- **Manufacturer visualizers** (free for homeowners, often co-branded with dealers). If you
  mostly sell one or two brands, ask your rep about a dealer-branded version before building
  your own.

### Build (more control, your own UX and products)

- **Segmentation:** **Meta SAM 3** (text prompts such as "window", "door", "siding", returns all
  instances; [repo](https://github.com/facebookresearch/sam3). Read its license file before
  commercial use) or a fine-tuned segmentation/detection model trained on labeled photos from
  your market.
- **Deterministic rendering:** per-wall homography (perspective correction) plus
  luminance-preserving blend, in WebGL (three.js or plain shaders) on the client.
- **Generative editing APIs** (prices are third-party reports from October 2026; check vendor pages):
  - **Google Gemini image models ("Nano Banana" family):** about **$0.034 (1K) to $0.113 (4K)** per
    image for the 2.x tier; Pro tier about **$0.134–$0.24**
    ([Laozhang](https://blog.laozhang.ai/en/posts/nano-banana-2-1),
    [MyArchitectAI](https://www.myarchitectai.com/blog/nano-banana-api-pricing)).
  - **Black Forest Labs FLUX.1 Kontext / FLUX.2** (instruction editing): about **$0.04–$0.045** per
    edit on fal ([fal](https://fal.ai/learn/tools/ai-image-editing-tools),
    [Movcl comparison](https://movcl.com/blog/comparisons/ai-image-api-prices-compared/)).
  - **OpenAI GPT Image** models: about **$0.01–$0.21** per image depending on version and quality
    ([Movcl comparison](https://movcl.com/blog/comparisons/ai-image-api-prices-compared/)).
  - Self-hosted open models (SDXL/FLUX with inpainting and ControlNet-style edge/depth guidance)
    when volume or privacy justifies running GPUs.

## Guardrails (this is where most visualizers go wrong)

1. **Use the homeowner's own photo**, not Street View (Google's terms) or listing photos
   (copyright). See [01-data-sources.md](01-data-sources.md).
2. **Constrain the generator.** Pass masks so only the target region changes. Guide with edges
   and depth so the geometry stays put.
3. **Check every generated image automatically.** Re-run the window/door detector on input and
   output. Reject renders where counts or positions changed.
4. **Tie every visual to a real SKU and color** from your catalog. Show the official swatch next to
   the render.
5. **Label renders as illustrative.** Colors vary by screen and light, and the final product is
   per the signed contract. Have counsel approve the disclaimer, because generative images that
   don't match what gets installed can lead to disputes.

## Recommendation

- **Phase 3a (weeks, not months):** embed or link a partner visualizer (Hover or your main
  manufacturer's) to measure whether homeowners use it and whether it lifts appointment rate.
- **Phase 3b:** build approach A (masks + swatches, real-time) on photos the homeowner already
  uploaded in Phase 2. Add pre-rendered generative hero images (approach B) with the guardrails
  above.
- **Later, only if the data justifies it:** self-hosted real-time generative, or a 3D approach
  through Hover's API.
