// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { TextInput } from './TextInput';

/** The text a screen reader reads after the field's name. */
function description(input: HTMLElement): string {
  return (input.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');
}

describe('TextInput', () => {
  it('is named by its visible label', () => {
    render(<TextInput label="Post link" />);
    expect(screen.getByLabelText('Post link').tagName).toBe('INPUT');
  });

  it('reads its hint with it', () => {
    render(<TextInput label="Post link" hint="Paste the link from the post's timestamp." />);
    expect(description(screen.getByLabelText('Post link'))).toContain("Paste the link from the post's timestamp.");
  });

  it('marks itself invalid and reads the error first', () => {
    render(<TextInput label="FB account" hint="The account you posted from." error="Pick one of your accounts." />);
    const input = screen.getByLabelText('FB account');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(description(input)).toBe('Pick one of your accounts. The account you posted from.');
  });

  it('is not invalid without an error', () => {
    render(<TextInput label="Post link" />);
    expect(screen.getByLabelText('Post link').getAttribute('aria-invalid')).toBeNull();
  });

  it('passes typing through', () => {
    const onChange = vi.fn();
    render(<TextInput label="Post link" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Post link'), { target: { value: 'https://facebook.com/x' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('shows something at its right edge', () => {
    render(<TextInput label="Your key" end={<button type="button">Show</button>} />);
    expect(screen.getByRole('button', { name: 'Show' })).toBeTruthy();
  });
});
