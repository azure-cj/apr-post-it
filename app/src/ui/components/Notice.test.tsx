// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { Notice } from './Notice';

describe('Notice', () => {
  it('interrupts with a danger or warn notice that appears', () => {
    render(
      <Notice tone="danger" live title="Copy is blocked">
        This document has no separator.
      </Notice>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Copy is blocked');
    expect(alert.textContent).toContain('This document has no separator.');
  });

  it('announces ok and info politely', () => {
    render(
      <Notice tone="ok" live>
        Logged.
      </Notice>,
    );
    expect(screen.getByRole('status').textContent).toBe('Logged.');
  });

  it('stays quiet when it is simply there on arrival', () => {
    render(<Notice tone="warn">No contact number.</Notice>);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('holds one action', () => {
    render(
      <Notice tone="info" action={<button type="button">Refresh</button>}>
        The directory was rebuilt.
      </Notice>,
    );
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
  });
});
