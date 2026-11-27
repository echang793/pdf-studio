import { describe, expect, it } from 'vitest'
import { PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib'
import { fillForm, listFields } from '../src/core/forms'
import { buildPdf, loadSource } from '../src/core/pdf'

async function formPdf() {
  const d = await PDFDocument.create()
  const p = d.addPage([400, 400])
  const f = await d.embedFont(StandardFonts.Helvetica)
  p.drawText('Application', { x: 20, y: 370, font: f, size: 14 })
  const form = d.getForm()
  form.createTextField('name').addToPage(p, { x: 20, y: 300, width: 200, height: 20 })
  form.createCheckBox('agree').addToPage(p, { x: 20, y: 260, width: 14, height: 14 })
  const dd = form.createDropdown('country')
  dd.addOptions(['Canada', 'Mexico', 'USA'])
  dd.addToPage(p, { x: 20, y: 220, width: 120, height: 20 })
  const rg = form.createRadioGroup('size')
  rg.addOptionToPage('S', p, { x: 20, y: 180, width: 14, height: 14 })
  rg.addOptionToPage('L', p, { x: 60, y: 180, width: 14, height: 14 })
  return new Uint8Array(await d.save())
}

describe('listFields', () => {
  it('lists every fillable field with its kind, value and choices', async () => {
    const fields = await listFields(await formPdf())
    expect(fields.map((f) => [f.name, f.kind])).toEqual([['name', 'text'], ['agree', 'checkbox'], ['country', 'dropdown'], ['size', 'radio']])
    expect(fields.find((f) => f.name === 'country')!.options).toEqual(['Canada', 'Mexico', 'USA'])
    expect(fields.find((f) => f.name === 'size')!.options).toEqual(['S', 'L'])
  })
  it('returns [] for a PDF without a form', async () => {
    const d = await PDFDocument.create()
    d.addPage()
    expect(await listFields(new Uint8Array(await d.save()))).toEqual([])
  })
})

describe('fillForm', () => {
  const values = { name: 'Ada Lovelace', agree: true, country: 'Mexico', size: 'L' }
  it('fills fields and keeps them editable when not flattening', async () => {
    const out = await fillForm(await formPdf(), values, { flatten: false })
    const fields = await listFields(out)
    expect(Object.fromEntries(fields.map((f) => [f.name, f.value]))).toEqual(values)
  })
  it('flattening bakes the values into the page and removes the fields', async () => {
    const out = await fillForm(await formPdf(), values, { flatten: true })
    expect(await listFields(out)).toEqual([])
    const d = await PDFDocument.load(out)
    expect(d.getPage(0).node.Annots()?.size() ?? 0).toBe(0)
    // ...and the filled-in appearances are now drawn as part of the page.
    const xo = d.getPage(0).node.Resources()?.lookup(PDFName.of('XObject')) as PDFDict | undefined
    expect(xo?.keys().length ?? 0).toBeGreaterThanOrEqual(4)
  })
})

describe('download keeps a filled (not flattened) form working', () => {
  it('the built PDF still has the fields, with their values', async () => {
    const filled = await fillForm(await formPdf(), { name: 'Ada', agree: true, country: 'USA', size: 'S' }, { flatten: false })
    const src = await loadSource('s', filled)
    const built = await buildPdf(src.pages, { s: filled }, {})
    const fields = await listFields(built)
    expect(Object.fromEntries(fields.map((f) => [f.name, f.value]))).toEqual({ name: 'Ada', agree: true, country: 'USA', size: 'S' })
  })
  it('a page duplicated twice does not break the form', async () => {
    const bytes = await formPdf()
    const src = await loadSource('s', bytes)
    const built = await buildPdf([src.pages[0], { ...src.pages[0], id: 'dup' }], { s: bytes }, {})
    expect((await PDFDocument.load(built)).getPageCount()).toBe(2)
    expect((await listFields(built)).length).toBeGreaterThanOrEqual(4)
  })
})
