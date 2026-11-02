import config from '@colyseus/tools';
import { configureExpress } from './server';

export default config({
  initializeExpress: (app) => {
    configureExpress(app);
  },
  initializeGameServer: (_gameServer) => {
    // Rooms will be registered in future milestones (HU-ESP-001)
  },
});
