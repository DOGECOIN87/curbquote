/** One complete report shared by downloads and print, including the exact price snapshot. */
import { propertySourceLines } from './property-data.js';
import { resolveHomeStyle } from './home-styles.js';
const TRADE_KEYS = ['siding', 'windows', 'doors', 'roofing', 'gutters'];
export function buildEstimateSummary(result, { address = '', matchedAddress = '', generatedAt = new Date().toISOString(), propertyData, footprintData } = {}) {
  const { inputs: i, geometry: g, assumptions: a, pricing: p } = result;
  const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const range = pair => pair.map(n => dollars.format(n)).join(' – ');
  // Keep externally supplied address text on one line in exported reports.
  const singleLine = value => String(value).replace(/[\r\n\u2028\u2029]/g, ' ');
  const styleName = result.project?.homeStyle ? resolveHomeStyle(result.project.homeStyle).name : '';
  const footprintLines = footprintData?.areaSqFt ? [
    `Footprint source: ${singleLine(footprintData.source?.provider || 'Public building outline')} (${Math.round(footprintData.areaSqFt)} sq ft ground outline — style variant, approximate, not a survey)`
  ] : [];
  return [
    'ALCO PRODUCTS / CURBQUOTE PRELIMINARY ESTIMATE',
    `Generated: ${generatedAt}`,
    `Calculation model: ${result.modelVersion}`,
    `Pricing: ${p.version}${p.customized ? ' (edited)' : ''} — illustrative example rates, not contractor pricing`,
    `Address entered: ${singleLine(address) || '(not provided)'}`,
    `Census address-range match: ${singleLine(matchedAddress) || 'Not matched'}`,
    ...propertySourceLines(propertyData),
    ...footprintLines,
    ...(result.project ? [
      `Selected projects: ${TRADE_KEYS.filter(key => result.project[key]).join(', ')}`,
      `Product tier: ${result.productNames.tier}`,
      `Products: ${TRADE_KEYS.filter(key => result.project[key]).map(key => result.productNames[key]).join('; ')}`,
      `Siding coverage: ${result.project.siding ? result.project.coveragePercent + '%' : 'not selected'}; color concept: ${result.productNames.color}${styleName ? `; style: ${styleName}` : ''}`
    ] : []),
    '',
    `Budget range: ${range(result.total)}`,
    `Siding: ${result.project?.siding === false ? 'Not selected' : range(result.items.siding)}`,
    `Windows (${i.replaceWindows}): ${range(result.items.windows)}`,
    `Doors (${i.replaceDoors}): ${range(result.items.doors)}`,
    ...(result.project?.roofing ? [`Roofing (${Math.round(g.roofSqFt)} sq ft of roof, ${g.roofPitch}/12 pitch from the gable rise, ${a.roofWasteFraction * 100}% waste, ±${a.roofVariation * 100}% area): ${range(result.items.roofing)}`] : []),
    ...(result.project?.gutters ? [`Gutters (${Math.round(g.gutterFt)} ft along the eaves, downspouts included): ${range(result.items.gutters)}`] : []),
    '',
    ...(result.project?.siding === false ? ['Building geometry is not used for this window/door-only budget.'] : [
    `Footprint: ${i.lengthFt} ft by ${i.widthFt} ft; ${i.stories} stories; ${i.storyHeightFt} ft/story`,
    `Gables: ${i.gables}; base assumed ${Math.min(i.lengthFt, i.widthFt)} ft; rise ${i.gableRiseFt} ft`,
    `Existing openings: ${i.existingWindows} windows, ${i.existingDoors} doors`,
    `Opening assumptions: ${a.windowOpeningSqFt} sq ft/window; ${a.doorOpeningSqFt} sq ft/door`,
    `Gross walls + gables: ${g.grossSqFt.toFixed(2)} sq ft; openings: ${g.openingsSqFt.toFixed(2)} sq ft`,
    `Solid wall area: ${g.solidWallsSqFt.toFixed(2)} sq ft; brick/stone: ${i.masonryPercent}% of solid walls (${g.masonrySqFt.toFixed(2)} sq ft)`,
    `Net siding: ${g.sidingNetSqFt.toFixed(2)} sq ft; with ${a.wasteFraction * 100}% waste: ${g.sidingOrderSqFt.toFixed(2)} sq ft`,
    `Siding quantity scenario: ±${a.geometryVariation * 100}% (illustrative, not a confidence interval)`,
    `Siding cost uses unrounded sq ft, not the ${g.squares} whole 100-sq-ft squares shown for reference.`,
    ]),
    `Prices (USD): siding ${i.sidingLowPerSqFt}–${i.sidingHighPerSqFt}/sq ft; windows ${i.windowLowEach}–${i.windowHighEach}/each; doors ${i.doorLowEach}–${i.doorHighEach}/each${result.project?.roofing ? `; roofing ${i.roofLowPerSquare}–${i.roofHighPerSquare}/square` : ''}${result.project?.gutters ? `; gutters ${i.gutterLowPerFt}–${i.gutterHighPerFt}/ft` : ''}`,
    'Rounding: each line-item endpoint is rounded to whole dollars, then line items are summed.',
    `Year built: ${i.yearBuilt}${result.leadPaintReview ? ' (review lead-safe renovation requirements; cost not included)' : ''}`,
    '',
    'Illustrative estimate only. Not a professional quote. Excludes site conditions, permits, taxes, disposal, specialty trim, rot, lead-safe work and regional factors.',
    'Rectangular footprint and equal gable bases are assumed. Measurements and opening sizes must be verified before ordering.',
    'Homeowner inputs are not independently verified. A Census match is an approximate address-range location, not ownership, parcel or building measurements.'
  ].join('\n') + '\n';
}
