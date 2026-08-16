import { render, screen } from '@testing-library/react';
import Changelog from './Changelog';
import { CHANGELOG } from '../changelog';

describe('Changelog', () => {
  test('renders every entry', () => {
    render(<Changelog />);
    // getByText throws if the entry is missing
    CHANGELOG.forEach((entry) => screen.getByText(entry.text));
  });

  test('shows each date once, however many entries share it', () => {
    render(<Changelog />);
    const uniqueDates = new Set(CHANGELOG.map((e) => e.date));
    const rendered = screen.getAllByText(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(rendered).toHaveLength(uniqueDates.size);
  });

  test('renders dates as dd/mm/yyyy', () => {
    render(<Changelog />);
    const [y, m, d] = CHANGELOG[0].date.split('-');
    screen.getAllByText(`${d}/${m}/${y}`);
  });
});
