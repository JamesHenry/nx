import * as spinners from 'cli-spinners';
import * as figures from 'figures';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import * as PropTypes from 'prop-types';
import * as React from 'react';

const possibleSpinnerNames = Object.keys(spinners).filter(
  (spinnerName) => spinnerName !== 'default'
);

const getSymbol = (state) => {
  if (state === 'warning') {
    return <Text color="yellow">{figures.warning}</Text>;
  }

  if (state === 'error') {
    return <Text color="red">{figures.cross}</Text>;
  }

  if (state === 'success') {
    return <Text color="green">{figures.tick}</Text>;
  }

  if (state === 'pending') {
    return <Text color="gray">{figures.squareSmallFilled}</Text>;
  }

  return ' ';
};

const getPointer = (state) => (
  <Text color={state === 'error' ? 'red' : 'yellow'}>{figures.pointer}</Text>
);

const TaskRow = ({
  label,
  state,
  status,
  output,
  spinnerType,
  isExpanded,
  children,
}) => {
  const childrenArray = React.Children.toArray(children);
  const listChildren = childrenArray.filter((node) =>
    React.isValidElement(node)
  );
  let icon =
    state === 'loading' ? (
      <Text color="yellow">
        <Spinner type={spinnerType} />
      </Text>
    ) : (
      getSymbol(state)
    );

  if (isExpanded) {
    icon = getPointer(state);
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Box marginRight={1}>
          <Text>{icon}</Text>
        </Box>
        <Text> {label}</Text>
        {status ? (
          <Box marginLeft={1}>
            <Text dimColor>[{status}]</Text>
          </Box>
        ) : undefined}
      </Box>
      {output ? (
        <Box marginLeft={2}>
          <Text color="gray">{`${figures.arrowRight} ${output}`}</Text>
        </Box>
      ) : undefined}
      {isExpanded && listChildren.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          {listChildren}
        </Box>
      )}
    </Box>
  );
};

TaskRow.propTypes = {
  children: PropTypes.oneOfType([
    PropTypes.arrayOf(PropTypes.element),
    PropTypes.element,
  ]),
  label: PropTypes.string.isRequired,
  state: PropTypes.oneOf(['pending', 'loading', 'success', 'warning', 'error']),
  status: PropTypes.string,
  output: PropTypes.string,
  spinnerType: PropTypes.oneOf(possibleSpinnerNames),
  isExpanded: PropTypes.bool,
};

TaskRow.defaultProps = {
  state: 'pending',
  spinnerType: 'dots',
};

export { TaskRow };
