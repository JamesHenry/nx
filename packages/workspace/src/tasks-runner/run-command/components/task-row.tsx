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
    return <Text color="gray">{figures.info}</Text>;
  }

  if (state === 'local-cache') {
    return <Text color="gray">📂</Text>;
  }

  if (state === 'remote-cache') {
    return <Text color="gray">☁️</Text>;
  }

  return ' ';
};

const TaskRow = ({ label, state, status, spinnerType, children }) => {
  const childrenArray = React.Children.toArray(children);
  const listChildren = childrenArray.filter((node) =>
    React.isValidElement(node)
  );
  let icon =
    state === 'loading' ? (
      <Text color="gray">
        <Spinner type={spinnerType} />
      </Text>
    ) : (
      getSymbol(state)
    );
  const isCacheState = state === 'local-cache' || state === 'remote-cache';

  return (
    <Box flexDirection="column">
      <Box>
        <Box marginRight={isCacheState ? 0 : 2}>
          <Text>{icon}</Text>
        </Box>
        <Text
          color={
            state === 'success'
              ? 'green'
              : state === 'error'
              ? 'red'
              : isCacheState
              ? 'cyan'
              : 'white'
          }
        >
          {' '}
          {label}
        </Text>
        {status ? (
          <Box marginLeft={1}>
            <Text dimColor>[{status}]</Text>
          </Box>
        ) : undefined}
      </Box>
    </Box>
  );
};

TaskRow.propTypes = {
  children: PropTypes.oneOfType([
    PropTypes.arrayOf(PropTypes.element),
    PropTypes.element,
  ]),
  label: PropTypes.string.isRequired,
  state: PropTypes.oneOf([
    'pending',
    'loading',
    'success',
    'warning',
    'error',
    'local-cache',
    'remote-cache',
  ]),
  status: PropTypes.string,
  spinnerType: PropTypes.oneOf(possibleSpinnerNames),
};

TaskRow.defaultProps = {
  state: 'pending',
  spinnerType: 'dots',
};

export { TaskRow };
