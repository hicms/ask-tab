import { withUI } from '@extension/ui/with-ui';

export default withUI({
  content: ['index.html', 'src/**/*.tsx', '../../packages/config-panels/lib/**/*.tsx'],
});
