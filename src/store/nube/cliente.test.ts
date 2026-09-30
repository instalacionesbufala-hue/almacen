import { describe, expect, it } from 'vitest';
import { urlProyecto } from './cliente';

describe('URL del proyecto de Supabase', () => {
  it('se queda solo con el dominio aunque se pegue con /rest/v1/ o barra final', () => {
    expect(urlProyecto('https://abc.supabase.co/rest/v1/')).toBe('https://abc.supabase.co');
    expect(urlProyecto(' https://abc.supabase.co/ ')).toBe('https://abc.supabase.co');
    expect(urlProyecto('https://abc.supabase.co')).toBe('https://abc.supabase.co');
    expect(urlProyecto('')).toBe('');
    expect(urlProyecto(undefined)).toBe('');
  });
});
