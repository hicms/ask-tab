import { withUI } from '@extension/ui/with-ui';

export default withUI({
  content: ['index.html', 'src/**/*.tsx', '../../packages/ui/lib/**/*.tsx'],
});
