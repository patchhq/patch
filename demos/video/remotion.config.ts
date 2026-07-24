import { Config } from '@remotion/cli/config';

// PNG frames → limited-range yuv420p (yuvj420p from JPEG breaks many players)
Config.setVideoImageFormat('png');
Config.setPixelFormat('yuv420p');
Config.setOverwriteOutput(true);
