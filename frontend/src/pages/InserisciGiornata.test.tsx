// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import InserisciGiornata from './InserisciGiornata';
import { clearRegister, hydrateAndSeed, saveEntry, exportBackupPayload } from '@/lib/store';
import { repo } from '@/lib/repo';

beforeEach(async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  await hydrateAndSeed();
  await clearRegister();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const open = (date: string) => render(<MemoryRouter initialEntries={[`/inserisci?data=${date}`]}><InserisciGiornata /></MemoryRouter>);
const entries = async () => JSON.parse(await exportBackupPayload()).days;
describe('navigazione mensile e salvataggio', () => {
  it.each([['2026-02-28',28],['2028-02-29',29],['2026-09-30',30],['2026-08-31',31]])('tutti i giorni di %s', (date, count) => {
    open(String(date));
    expect(screen.getAllByRole('button', { name: /^Giorno \d+$/ })).toHaveLength(Number(count));
  });
  it('31 → 1 → 5, salvataggio e ritorno: stessi dati, nessun duplicato', async () => {
    await saveEntry({id:'day5',date:'2026-08-05',dayType:'lavoro',start:'06:00',end:'18:00',breakMinutes:30,notturno:false,reperibilita:false,trasferta:false,festivo:null,note:'',createdAt:'2026-08-05',updatedAt:'2026-08-05'});
    open('2026-08-31');
    fireEvent.click(screen.getByRole('button', {name:'Giorno 1'}));
    expect((screen.getByTestId('input-entry-date') as HTMLInputElement).value).toBe('2026-08-01');
    fireEvent.change(screen.getByLabelText('Vai al giorno'),{target:{value:'2026-08-05'}});
    expect((screen.getByTestId('input-entry-time-end') as HTMLInputElement).value).toBe('18:00');
    fireEvent.change(screen.getByTestId('input-entry-time-end'),{target:{value:'19:00'}});
    fireEvent.click(screen.getByTestId('btn-save-entry'));
    await waitFor(async () => expect((await entries())[0]).toMatchObject({id:'day5',end:'19:00'}));
    await waitFor(() => expect(screen.getByTestId('entry-form-title').textContent).toBe('Modifica giornata'));
    fireEvent.click(screen.getByRole('button', {name:'Giorno 31'}));
    fireEvent.click(screen.getByRole('button', {name:'Giorno 5'}));
    expect((screen.getByTestId('input-entry-time-end') as HTMLInputElement).value).toBe('19:00');
    expect(await entries()).toHaveLength(1);
  });
  it('non perde modifiche se il cambio giorno viene annullato', () => {
    vi.spyOn(window,'confirm').mockReturnValue(false);
    open('2026-08-31');
    fireEvent.change(screen.getByTestId('input-entry-time-start'),{target:{value:'06:00'}});
    fireEvent.click(screen.getByRole('button',{name:'Giorno 5'}));
    expect((screen.getByTestId('input-entry-date') as HTMLInputElement).value).toBe('2026-08-31');
  });
  it('aprendo una data già salvata modifica il record esistente', async () => {
    await saveEntry({id:'leave',date:'2026-08-05',dayType:'ferie',start:'',end:'',breakMinutes:0,notturno:false,reperibilita:false,trasferta:false,festivo:null,note:'',createdAt:'2026-08-05',updatedAt:'2026-08-05'});
    open('2026-08-05'); fireEvent.click(screen.getByTestId('btn-save-entry'));
    await waitFor(async () => expect((await entries())[0].dayType).toBe('ferie'));
    expect(await entries()).toHaveLength(1);
  });
  it('mostra errore e non successo quando IndexedDB rifiuta il salvataggio', async () => {
    const previous = {id:'leave',date:'2026-08-05',dayType:'ferie' as const,start:'',end:'',breakMinutes:0,notturno:false,reperibilita:false,trasferta:false,festivo:null,note:'Originale',createdAt:'2026-08-05',updatedAt:'2026-08-05'};
    await saveEntry(previous);
    const success = vi.spyOn(toast, 'success');
    const error = vi.spyOn(toast, 'error');
    vi.spyOn(repo, 'updateState').mockRejectedValueOnce(new Error('Quota IndexedDB esaurita'));
    open('2026-08-05');
    fireEvent.change(screen.getByTestId('input-entry-note'), { target: { value: 'Modifica non salvata' } });

    fireEvent.click(screen.getByTestId('btn-save-entry'));

    await waitFor(() => expect(error).toHaveBeenCalledWith('Impossibile salvare la giornata. I dati precedenti sono stati conservati.'));
    expect(success).not.toHaveBeenCalled();
    expect((await entries())[0]).toMatchObject(previous);
  });
});
