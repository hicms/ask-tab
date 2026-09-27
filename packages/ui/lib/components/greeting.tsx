import { useT } from '@extension/i18n';
import { motion } from 'framer-motion';

const Greeting = () => {
  const t = useT();

  return (
    <div
      className="relative mx-auto flex w-full max-w-3xl flex-col items-center justify-center px-4 text-center"
      key="overview">
      <div className="pointer-events-none absolute -z-10 h-36 w-72 rounded-full bg-violet-100/50 blur-3xl dark:bg-violet-500/10" />
      <svg aria-hidden="true" className="mb-5 size-9" viewBox="0 0 40 40">
        <path
          className="fill-blue-500"
          d="M19 2 22.8 14.2 35 18l-12.2 3.8L19 34l-3.8-12.2L3 18l12.2-3.8L19 2Z"
        />
        <path
          className="fill-violet-400"
          d="m32 3 1.4 4.6L38 9l-4.6 1.4L32 15l-1.4-4.6L26 9l4.6-1.4L32 3Z"
        />
      </svg>
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-50"
        exit={{ opacity: 0, y: 10 }}
        initial={{ opacity: 0, y: 8 }}
        transition={{ delay: 0.02, duration: 0.18 }}>
        {t('greeting_hello')}
      </motion.div>
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="mt-2 text-sm text-slate-500 sm:text-base dark:text-slate-400"
        exit={{ opacity: 0, y: 10 }}
        initial={{ opacity: 0, y: 8 }}
        transition={{ delay: 0.06, duration: 0.18 }}>
        {t('greeting_help')}
      </motion.div>
    </div>
  );
};

export { Greeting };
