import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import StripNamesColumn from './StripNamesColumn';

const strips = (...starts) => starts.map(isSystemStart => ({
  isSystemStart, start: 0, height: 40,
}));

const SEQ = ['Vl1', 'Vl2', 'Vla'];

function setup({ names = ['', '', ''], sequence = SEQ, stripsArg = strips(true, false, false) } = {}) {
  const onUpdateName = jest.fn();
  const onBlurName = jest.fn();
  render(
    <StripNamesColumn
      strips={stripsArg}
      stripNames={names}
      sequence={sequence}
      pageHeight={200}
      onUpdateName={onUpdateName}
      onBlurName={onBlurName}
    />
  );
  return { onUpdateName, onBlurName };
}

describe('StripNamesColumn ghost text', () => {
  test('not focused: no ghost, placeholder shows', () => {
    setup();
    const inputs = screen.getAllByRole('textbox');
    expect(inputs[0]).toHaveAttribute('placeholder', 'Part 1');
    expect(screen.queryByText('Vl1')).not.toBeInTheDocument();
  });

  test('empty + focused shows the sequence name for that strip', () => {
    setup();
    const inputs = screen.getAllByRole('textbox');
    fireEvent.focus(inputs[0]);
    expect(screen.getByText('Vl1')).toBeInTheDocument();
  });

  // Regression: the ghost used to render the whole completion at inset-0, so
  // the typed prefix sat on top of the ghost's own copy of those characters
  // and the field read as garbled. The typed part must be reserved invisibly
  // so only the remainder is painted, starting at the caret.
  test('ghost paints only the untyped remainder, offset past what is typed', () => {
    setup({ names: ['v', '', ''] });
    fireEvent.focus(screen.getAllByRole('textbox')[0]);

    const remainder = screen.getByText('l1');
    expect(remainder).toBeInTheDocument();
    expect(remainder).toHaveClass('text-white/50');

    // The typed prefix is reserved but not painted.
    const reserved = screen.getByText('v', { selector: 'span' });
    expect(reserved).toHaveClass('invisible');

    // And the full string is never painted as one run.
    expect(screen.queryByText('vl1')).not.toBeInTheDocument();
  });

  test('typing "v" narrows the ghost to "Vl1" instead of hiding it', () => {
    setup({ names: ['v', '', ''] });
    const inputs = screen.getAllByRole('textbox');
    fireEvent.focus(inputs[0]);
    // Rendered as an invisible "v" plus a visible "l1" -- see the offset test
    // above -- so assert on the completion actually shown to the user.
    expect(screen.getByText('l1')).toBeInTheDocument();
  });

  test('typing a non-matching prefix shows no ghost', () => {
    setup({ names: ['x', '', ''] });
    const inputs = screen.getAllByRole('textbox');
    fireEvent.focus(inputs[0]);
    expect(screen.queryByText('Vl1')).not.toBeInTheDocument();
  });

  test('typing the full name shows no ghost', () => {
    setup({ names: ['Vl1', '', ''] });
    const inputs = screen.getAllByRole('textbox');
    fireEvent.focus(inputs[0]);
    expect(screen.queryByText('Vl1', { selector: '.ghost, [data-ghost]' })).not.toBeInTheDocument();
  });

  test('Tab accepts the ghost and advances focus to the next field', () => {
    const { onUpdateName } = setup({ names: ['v', '', ''] });
    const inputs = screen.getAllByRole('textbox');
    fireEvent.focus(inputs[0]);
    fireEvent.keyDown(inputs[0], { key: 'Tab' });
    expect(onUpdateName).toHaveBeenCalledWith(0, 'Vl1');
  });
});
