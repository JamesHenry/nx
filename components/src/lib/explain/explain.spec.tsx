import { render } from '@testing-library/react';

import Explain from './explain';

describe('Explain', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<Explain />);
    expect(baseElement).toBeTruthy();
  });
});
