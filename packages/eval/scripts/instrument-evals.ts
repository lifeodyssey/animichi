import { configure } from '@pydantic/logfire-node';
import { traceSampleRate } from '../src/native/trace-sampling.ts';

const token = process.env.LOGFIRE_TOKEN?.trim();

configure({
  serviceName: 'animichi-eval',
  token,
  sendToLogfire: Boolean(token),
  sampling: { head: traceSampleRate(process.env.EVAL_TRACE_SAMPLE_RATE) },
  console: false,
});

if (!token) {
  process.stderr.write('Logfire uploader unconfigured; native report artifacts remain available.\n');
}
