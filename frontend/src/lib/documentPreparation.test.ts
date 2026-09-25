import { afterEach, describe, expect, it, vi } from 'vitest';
import { bounded, imageDimensions, prepareDocument, validateDocument } from './documentPreparation';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('preparazione documenti', () => {
  it.each([
    ['application/pdf',[37,80,68,70,45]], ['image/jpeg',[255,216,255]], ['image/png',[137,80,78,71,13,10,26,10]],
  ])('accetta %s verificando il contenuto', async (type, bytes) => {
    expect(await validateDocument(new File([new Uint8Array(bytes)],'prova',{type}))).toBe(type);
  });
  it('riconosce foto smartphone senza MIME',async () => {
    expect(await validateDocument(new File([new Uint8Array([255,216,255])],'foto.jpg'))).toBe('image/jpeg');
  });
  it('rifiuta formato non supportato',async () => { await expect(validateDocument(new File(['text'],'x.txt',{type:'text/plain'}))).rejects.toThrow('Formato non supportato'); });
  it('rifiuta file corrotto e MIME contraffatto',async () => { await expect(validateDocument(new File(['broken'],'x.pdf',{type:'application/pdf'}))).rejects.toThrow('danneggiato'); });
  it('limita le foto grandi senza deformarle',() => { expect(imageDimensions(8000,6000)).toEqual({width:2800,height:2100}); expect(imageDimensions(600,800)).toEqual({width:600,height:800}); });
  it('rifiuta dimensioni eccessive',() => { expect(()=>imageDimensions(50000,50000)).toThrow('troppo grande'); });
  it('rifiuta oltre 15 MB',async () => { await expect(validateDocument(new File([new Uint8Array(15*1024*1024+1)],'x.jpg',{type:'image/jpeg'}))).rejects.toThrow('15 MB'); });
  it('PDF conserva i byte e rimuove il nome personale', async () => { const input=new File(['%PDF-1.7'],'nome-cognome.pdf',{type:'application/pdf'});const out=await prepareDocument(input);expect(await out.text()).toBe(await input.text());expect(out.name).toBe('documento.pdf'); });
  it('corregge EXIF e ricodifica senza metadata prima di OCR/AI', async () => {
    const close=vi.fn();const decode=vi.fn().mockResolvedValue({width:4000,height:3000,close});vi.stubGlobal('createImageBitmap',decode);
    const draw=vi.fn();vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>({fillRect:vi.fn(),drawImage:draw}),toBlob:(cb:(blob:Blob)=>void)=>cb(new Blob(['image'],{type:'image/jpeg'}))})});
    const input=new File([new Uint8Array([255,216,255])],'foto.jpg',{type:'image/jpeg'});const out=await prepareDocument(input);
    expect(decode).toHaveBeenCalledWith(input,{imageOrientation:'from-image'});expect(draw).toHaveBeenCalledWith(expect.anything(),0,0,2800,2100);expect(close).toHaveBeenCalled();expect(out.type).toBe('image/jpeg');
  });
  it('timeout finito e cancellazione del lavoro',async () => {vi.useFakeTimers();const cancel=vi.fn();const result=bounded(new Promise(()=>undefined),100,'tempo scaduto',cancel);const assertion=expect(result).rejects.toThrow('tempo scaduto');await vi.advanceTimersByTimeAsync(100);await assertion;expect(cancel).toHaveBeenCalledOnce();});
});
