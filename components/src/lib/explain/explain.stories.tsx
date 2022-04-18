import { Story, Meta } from '@storybook/react';
import { Explain, ExplainProps } from './explain';

export default {
  component: Explain,
  title: 'Explain',
} as Meta;

const Template: Story<ExplainProps> = (args) => <Explain {...args} />;

export const Primary = Template.bind({});
Primary.args = {};
