import { describe, expect, it } from 'vitest'
import { findWatermarkRanges, parseContent, removeRanges } from '../src/core/contentStream'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder('latin1').decode(b)

describe('parseContent', () => {
  it('reads operators with their operands and byte spans', () => {
    const src = 'q 1 0 0 1 50 60 cm BT /F1 12 Tf (Hello) Tj ET Q'
    const ops = parseContent(enc(src))
    expect(ops.map((o) => o.op)).toEqual(['q', 'cm', 'BT', 'Tf', 'Tj', 'ET', 'Q'])
    const tf = ops[3]
    expect(tf.operands).toEqual([{ t: 'name', v: 'F1' }, { t: 'num', v: 12 }])
    expect(src.slice(tf.start, tf.end)).toBe('/F1 12 Tf')
  })
  it('is not fooled by operator-looking text inside strings, hex strings, dicts and comments', () => {
    const src = '(a \\) EMC (nested) BDC) Tj <454D43> Tj % EMC in a comment\n/P <</MCID 3 /Alt (x EMC)>> BDC EMC'
    const ops = parseContent(enc(src))
    expect(ops.map((o) => o.op)).toEqual(['Tj', 'Tj', 'BDC', 'EMC'])
    expect(ops[2].operands[1]).toMatchObject({ t: 'dict' })
  })
  it('skips inline image data, even when it contains EMC or EI-like bytes', () => {
    const src = 'BI /W 2 /H 1 /BPC 8 /CS /G ID \x00EMC\x45\x49x EI Q'
    const ops = parseContent(enc(src))
    expect(ops.map((o) => o.op)).toEqual(['BI', 'Q'])
  })
})

describe('findWatermarkRanges + removeRanges', () => {
  const none = () => false
  it('removes an /Artifact /Watermark marked-content block and keeps everything else byte-for-byte', () => {
    const keep1 = 'BT /F1 12 Tf 72 700 Td (Body text) Tj ET\n'
    const wm = '/Artifact <</Type /Pagination /Subtype /Watermark>> BDC q 0.5 g BT /F1 60 Tf (DRAFT) Tj ET Q EMC'
    const keep2 = '\nBT /F1 12 Tf 72 680 Td (More) Tj ET'
    const bytes = enc(keep1 + wm + keep2)
    const r = findWatermarkRanges(parseContent(bytes), { props: none, xobject: none })
    expect(r.ranges).toHaveLength(1)
    expect(dec(removeRanges(bytes, r.ranges))).toBe(keep1 + keep2)
  })
  it('leaves ordinary artifacts (headers, page numbers) and tagged content alone', () => {
    const src = '/Artifact <</Type /Pagination /Subtype /Header>> BDC (Head) Tj EMC /P <</MCID 0>> BDC (x) Tj EMC /Artifact BMC (y) Tj EMC'
    expect(findWatermarkRanges(parseContent(enc(src)), { props: none, xobject: none }).ranges).toEqual([])
  })
  it('uses the resolver for named property lists (/OC /oc1 BDC) and for XObjects drawn with Do', () => {
    const src = 'q /OC /oc1 BDC (WM) Tj EMC Q q /Fm0 Do Q q /Im1 Do Q'
    const ops = parseContent(enc(src))
    const r = findWatermarkRanges(ops, { props: (n) => n === 'oc1', xobject: (n) => n === 'Fm0' })
    expect(dec(removeRanges(enc(src), r.ranges)).replace(/\s+/g, ' ').trim()).toBe('q Q q Q q /Im1 Do Q')
    expect([...r.props]).toEqual(['oc1'])
    expect([...r.xobjects]).toEqual(['Fm0'])
  })
  it('removes a watermark block nested inside other marked content without unbalancing it', () => {
    const src = '/P <</MCID 1>> BDC (a) Tj /Artifact <</Subtype /Watermark>> BDC (W) Tj EMC (b) Tj EMC'
    const r = findWatermarkRanges(parseContent(enc(src)), { props: none, xobject: none })
    const out = dec(removeRanges(enc(src), r.ranges))
    expect(out).not.toContain('(W)')
    expect(out.match(/BDC/g)).toHaveLength(1)
    expect(out.match(/EMC/g)).toHaveLength(1)
  })
})
