import { useT } from '@extension/i18n';
import { motion } from 'framer-motion';

const Greeting = () => {
  const t = useT();

  return (
    <div
      className="mx-auto flex w-full max-w-3xl flex-col justify-center px-4 md:px-8"
      key="overview">
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="text-xl font-semibold md:text-2xl"
        exit={{ opacity: 0, y: 10 }}
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.5 }}>
        {t('greeting_hello')}
      </motion.div>
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="text-xl text-zinc-500 md:text-2xl"
        exit={{ opacity: 0, y: 10 }}
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.6 }}>
        {t('greeting_help')}
      </motion.div>
    </div>
  );
};

export { Greeting };
