// Loaded with `node --import` before server.js in tests: the server sees the fake internet.
import { installFakeNet } from './fake-net.js';

installFakeNet();
