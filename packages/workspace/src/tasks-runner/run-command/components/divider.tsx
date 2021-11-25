import * as React from 'react';
import { Box, Text } from 'ink';
import * as PropTypes from 'prop-types';
import stringWidth from 'string-width';

// Helpers
const getSideDividerWidth = (width, titleWidth) => (width - titleWidth) / 2;
const getNumberOfCharsPerWidth = (char, width) => width / stringWidth(char);

const PAD = ' ';

// Divider
export const Divider = ({
  title,
  width,
  padding,
  titlePadding,
  titleColor,
  dividerChar,
  dividerColor,
}) => {
  const titleString = title
    ? `${PAD.repeat(titlePadding) + title + PAD.repeat(titlePadding)}`
    : '';
  const titleWidth = stringWidth(titleString);

  const dividerWidth = getSideDividerWidth(width, titleWidth);
  const numberOfCharsPerSide = getNumberOfCharsPerWidth(
    dividerChar,
    dividerWidth
  );
  const dividerSideString = dividerChar.repeat(numberOfCharsPerSide);

  const paddingString = PAD.repeat(padding);

  return (
    <Box flexDirection="row">
      <Text>
        {paddingString}
        <Text dimColor={true} color={dividerColor}>
          {dividerSideString}
        </Text>
        <Text dimColor={true} color={titleColor}>
          {titleString}
        </Text>
        <Text dimColor={true} color={dividerColor}>
          {dividerSideString}
        </Text>
        {paddingString}
      </Text>
    </Box>
  );
};

Divider.propTypes = {
  title: PropTypes.string,
  width: PropTypes.number,
  padding: PropTypes.number,
  titlePadding: PropTypes.number,
  titleColor: PropTypes.string,
  dividerChar: PropTypes.string,
  dividerColor: PropTypes.string,
};

Divider.defaultProps = {
  title: null,
  width: 50,
  padding: 1,
  titlePadding: 1,
  titleColor: 'white',
  dividerChar: '─',
  dividerColor: 'grey',
};
