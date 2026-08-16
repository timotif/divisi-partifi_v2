import '@testing-library/jest-dom';
import { useState } from 'react';
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

  // Regression: the placeholder and the ghost share an origin, so leaving the
  // placeholder set painted "Part 1" and "Vl1" on top of each other.
  test('the placeholder gives way to the ghost', () => {
    setup();
    const input = screen.getAllByRole('textbox')[0];
    expect(input).toHaveAttribute('placeholder', 'Part 1');

    fireEvent.focus(input);
    expect(screen.getByText('Vl1')).toBeInTheDocument();
    expect(input).toHaveAttribute('placeholder', '');

    fireEvent.blur(input);
    expect(input).toHaveAttribute('placeholder', 'Part 1');
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

describe('focusing a field selects the name already in it', () => {
  test('the whole name is selected, so one backspace clears it', () => {
    setup({ names: ['Vl1', '', ''] });
    const input = screen.getAllByRole('textbox')[0];
    fireEvent.focus(input);

    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Vl1'.length);
  });

  test('an empty field has nothing to select and still ghosts', () => {
    setup({ names: ['', '', ''] });
    const input = screen.getAllByRole('textbox')[0];
    fireEvent.focus(input);

    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(0);
    expect(screen.getByText('Vl1')).toBeInTheDocument();
  });
});

// Issue #3: a name that is a prefix of a sequence entry could not be committed
// as itself, because the ghost always completed it and Tab always took the
// completion.
describe('Escape dismisses the ghost', () => {
  const PICC = ['fl picc', 'ob'];

  // The completion here starts with a space, which getByText would normalise
  // away, so these queries keep the raw text.
  const picc = (q) => q(' picc', { normalizer: (s) => s });

  test('the ghost completes a prefix by default', () => {
    setup({ names: ['fl', ''], sequence: PICC, stripsArg: strips(true, false) });
    const input = screen.getAllByRole('textbox')[0];
    fireEvent.focus(input);
    expect(picc(screen.getByText)).toBeInTheDocument();
  });

  test('Escape hides the ghost but keeps the typed text', () => {
    const { onUpdateName } = setup({
      names: ['fl', ''], sequence: PICC, stripsArg: strips(true, false),
    });
    const input = screen.getAllByRole('textbox')[0];
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(picc(screen.queryByText)).not.toBeInTheDocument();
    expect(input).toHaveValue('fl');
    expect(onUpdateName).not.toHaveBeenCalled();
  });

  test('Tab after Escape commits the literal text instead of the completion', () => {
    const { onUpdateName } = setup({
      names: ['fl', ''], sequence: PICC, stripsArg: strips(true, false),
    });
    const input = screen.getAllByRole('textbox')[0];
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.keyDown(input, { key: 'Tab' });

    // No ghost to accept, so Tab falls through to normal field navigation and
    // "fl" stands as typed.
    expect(onUpdateName).not.toHaveBeenCalledWith(0, 'fl picc');
  });

  test('typing again brings the ghost back', () => {
    // stripNames is a prop, so a real keystroke has to come back through the
    // parent. Rendering a stateful host keeps the value and the ghost in step
    // the way the app does; firing change with an unchanged value would not
    // reach onChange at all.
    const Host = () => {
      const [names, setNames] = useState(['f', '']);
      return (
        <StripNamesColumn
          strips={strips(true, false)}
          stripNames={names}
          sequence={PICC}
          pageHeight={200}
          onUpdateName={(i, v) => setNames(prev => prev.map((n, j) => (j === i ? v : n)))}
          onBlurName={() => {}}
        />
      );
    };
    render(<Host />);

    const input = screen.getAllByRole('textbox')[0];
    fireEvent.focus(input);
    expect(screen.getByText('l picc')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByText('l picc')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'fl' } });
    expect(picc(screen.getByText)).toBeInTheDocument();
  });

  test('the dismissal does not leak to another field', () => {
    setup({ names: ['fl', ''], sequence: PICC, stripsArg: strips(true, false) });
    const inputs = screen.getAllByRole('textbox');
    fireEvent.focus(inputs[0]);
    fireEvent.keyDown(inputs[0], { key: 'Escape' });

    fireEvent.blur(inputs[0]);
    fireEvent.focus(inputs[1]);
    expect(screen.getByText('ob')).toBeInTheDocument();
  });
});
