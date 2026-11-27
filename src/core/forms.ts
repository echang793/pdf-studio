import { PDFArray, PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFName, PDFObjectCopier, PDFOptionList, PDFRadioGroup, PDFRef, PDFTextField } from 'pdf-lib'

export type FieldKind = 'text' | 'checkbox' | 'dropdown' | 'list' | 'radio'
export interface FormField {
  name: string
  kind: FieldKind
  value: string | boolean
  /** Choices for dropdown / list / radio. */
  options?: string[]
  readOnly: boolean
  multiline?: boolean
}

/** Fillable fields of a PDF form, in document order (buttons and signature fields are left out). */
export async function listFields(bytes: Uint8Array): Promise<FormField[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  let fields
  try { fields = doc.getForm().getFields() } catch { return [] }
  const out: FormField[] = []
  for (const f of fields) {
    const base = { name: f.getName(), readOnly: f.isReadOnly() }
    if (f instanceof PDFTextField) out.push({ ...base, kind: 'text', value: f.getText() ?? '', multiline: f.isMultiline() })
    else if (f instanceof PDFCheckBox) out.push({ ...base, kind: 'checkbox', value: f.isChecked() })
    else if (f instanceof PDFDropdown) out.push({ ...base, kind: 'dropdown', value: f.getSelected()[0] ?? '', options: f.getOptions() })
    else if (f instanceof PDFOptionList) out.push({ ...base, kind: 'list', value: f.getSelected()[0] ?? '', options: f.getOptions() })
    else if (f instanceof PDFRadioGroup) out.push({ ...base, kind: 'radio', value: f.getSelected() ?? '', options: f.getOptions() })
  }
  return out
}

/** Write values into the form (by field name) and optionally flatten it into the page. Unknown names are ignored. */
export async function fillForm(bytes: Uint8Array, values: Record<string, string | boolean>, opts: { flatten: boolean }): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const form = doc.getForm()
  for (const f of form.getFields()) {
    const name = f.getName()
    if (!(name in values) || f.isReadOnly()) continue
    const v = values[name]
    if (f instanceof PDFTextField) f.setText(String(v) || undefined)
    else if (f instanceof PDFCheckBox) { if (v) f.check(); else f.uncheck() }
    else if (f instanceof PDFDropdown) { if (v) f.select(String(v)); else f.clear() }
    else if (f instanceof PDFOptionList) { if (v) f.select(String(v)); else f.clear() }
    else if (f instanceof PDFRadioGroup) { if (v) f.select(String(v)); else f.clear() }
  }
  if (opts.flatten) {
    form.flatten()
    // pdf-lib can leave the page's /Annots pointing at the removed widgets; drop any widget or dangling entry.
    for (const page of doc.getPages()) {
      const annots = page.node.lookup(PDFName.of('Annots'))
      if (!(annots instanceof PDFArray)) continue
      const keep = annots.asArray().filter((a) => {
        const d = a instanceof PDFRef ? doc.context.lookup(a) : a
        return d instanceof PDFDict && d.get(PDFName.of('Subtype'))?.toString() !== '/Widget'
      })
      if (keep.length) page.node.set(PDFName.of('Annots'), doc.context.obj(keep))
      else page.node.delete(PDFName.of('Annots'))
    }
  }
  return new Uint8Array(await doc.save())
}

/**
 * pdf-lib's copyPages brings a page's form widgets (and their field dicts) along but not the document's AcroForm,
 * so the fields would show but not work. Rebuild it in `out` from the copied widgets, with the default
 * appearance/resources of the first source that had a form.
 */
export function keepForms(out: PDFDocument, sources: PDFDocument[]) {
  const top = new Set<PDFRef>()
  for (const page of out.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots'))
    if (!(annots instanceof PDFArray)) continue
    for (const a of annots.asArray()) {
      if (!(a instanceof PDFRef)) continue
      const d = out.context.lookup(a)
      if (!(d instanceof PDFDict) || d.get(PDFName.of('Subtype'))?.toString() !== '/Widget') continue
      let ref = a
      for (let guard = 0; guard < 32; guard++) {
        const parent = (out.context.lookup(ref) as PDFDict).get(PDFName.of('Parent'))
        if (!(parent instanceof PDFRef)) break
        ref = parent
      }
      top.add(ref)
    }
  }
  if (top.size === 0) return
  const acro = out.context.obj({ Fields: [...top] }) as PDFDict
  const src = sources.find((s) => s.catalog.lookup(PDFName.of('AcroForm')) instanceof PDFDict)
  const srcForm = src?.catalog.lookup(PDFName.of('AcroForm')) as PDFDict | undefined
  if (src && srcForm) {
    const copier = PDFObjectCopier.for(src.context, out.context)
    for (const k of ['DR', 'DA', 'Q']) {
      const v = srcForm.get(PDFName.of(k))
      if (v) acro.set(PDFName.of(k), copier.copy(v))
    }
  }
  out.catalog.set(PDFName.of('AcroForm'), out.context.register(acro))
}
