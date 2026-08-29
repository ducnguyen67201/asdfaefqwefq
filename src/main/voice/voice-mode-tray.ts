import type { VoiceMode } from '../../shared/contracts';

const DICTATION_TRAY_ICON_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAEUklEQVRYw92Yz29UVRTHP+e+N7/MTDtIoW1KwUWJQNTEX1BJtCFGhe6MC+LahTujcSOCxqQI8e8wbo0bA/IHSIx2SlTEqAtNW1oHSltskc6bd4+LN9OZ9+bNe1PbGOJJbub+OO+e7z3fc8+9d+TAgRHlARI3TaH09rsUTr+Od62CZDL41Sr2z0VAkEIBMziEKRVRr45dXgYByeawy3fQtTUkn8cMDYFXB9dh5Z23Eu1JnIf6py6AMU0VoE1FCbd7EZHgE2nNt3r2vd4A9Z+/CNIEo4QBSTuq7Yvvs/rh2VCXaW/0T11oGWzaDhnXnQMD4Dj0nTkX6grHkDENm/9BnDecL8VivIf6z18MKps875DRbtJmp++jqU5A9tatiHKzLp2FtiIpJaoTg1gymc2eTcrM3r0xqxD8xUXqv/wMvo33eS+8ADgG9+CjOMPD4ZDQ8DzJechavMp3eDdugNkmjdaif63hnJoMeyritWRAqmitBsYg2wSkgHo1sApO97mSAYkg2RyoRa2JGQeJrFBVO2hoLk6yuVRPpwAyZJ9+BlMuo9YnnBgFf34Of2Gh5XUFd98oZmiYaHYXx8EdG2sk3e7bL+UsU8zgINlmILYHozF4MxX8hZstoCJkHn8C9/ARsLbLlMk5LsJDjDutxd6+ja6vtyZsFhEk+o1IWCdaUiQCSDsm96tV/v7ic+5f+hK7tNR2zsVRzLZPFpOmIPk8ks9T/+N37l+5HFw9uoFKSk3dgKqGxpIpU8WUy+RfegVn3yj+4iL3v7qEPzfblrF7lG6qIqGxZMqaoAYHyb0wgSkW8W9V8a7NgO+HjfSSuHuQVMoQQVdW8GYq6L11THkX7qHDjZuBtpYgoNbi37wJnvev0aUmRru6ysaVy9RnZ3GGhshNnMAZGYlhQpBsBu+H75FsluzRY+C6W77KpALSu3exd+7gjo2Re34Cs+thUBs+gxTIZcifeJH63By1yjSokj02ng4qQnXq4eoMD1N49TWkVEIKhQBMLHiDGdhDfuwgtb4+ajMVVJXc+HPguHTdZhFm3c7RyIeOg9k7GPQnrVQIwGYyZJ89iimX2bj6NaiSGz8eeKqHJJW+y2gY6jUWGnruocMUTk1iq1U2vrkK9d4CPX2XbUkaBq2l/tuv2KUlzO7deJVpvOs/xtwYOyX1oZgomUxwnbBN7zV+RfDn56lNf4vk8jijo0ipRCwDzTdbB6DIQy5VrMU98Ajy8km0XkccFymWAsqMIfvkU/jzc2At+ZOTSL4QT3vjkO4EFPsOSyGo8BDuoSOtNTR3oCpSLJEbPx5Q5TjJE/l+JyDvp+tkjjy2RVAa0BUXGmpx9u/HDAwgKTts9YP3N+ubQX3vs0+755hENyWNSfAQTAhmM7An3A4hPXem00DseyrZaeG2xtcB9TyW33wjbK7b/0P9H38SzL65C+ICMsZTiXciDbK2Xw8WH+fUB+0Pqx1OjP9DQP8AIiueUx3w/DgAAAAASUVORK5CYII=';
const TASK_TRAY_ICON_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAFCklEQVRYw92YSYwUVRjHf+9V9TIzPUzPBjNhGNABB5VgAhLhArgEwgFN8CCCHvWsR1EvxuCJu4knEwJ68qhwMcBBNDAYRQyEQYFZGBqcjYm9VX0euqq6qvpVd0cPGl/SSXe9b/m///u2arV+/VrhP7TsVgIn3n2MVw8PM3lliUxaMTVX5u5cCaWgM2sxOpQh321RrgiF+QoA2YymMF9h8ZFDZ0YzOpyhXBFsS3HwnWtN/SkTQyc/fgLLUiCgFIgn0ZJK8RQCaRXZVnj2gNffu94eoFPHx9EqalK8L6oVKH9TEcUTV/KeV6vCmx/eiGzpODP+QeM+kOj34IfEfscBxtkNgbQtxafHxpIBWR41EgMVYT5+8uitmBlpItLTHQ3jANCp4+OtrcTBtXAuTdT8eAL4/KNNjYBmCuW6YMiCVjXF4BMy1uoT1tU6FO+effGuNJ2qX1TA19rBtJGM27MlfryxguNEqWj35vznllY8M97F+qFMkCQArggqpG1HvMd4dlzh3MQil39dCTLv7y7XhYVHVY4eGERrFaDVKmq4aWEUgVJZ0Koe8EkshDM+wRqlstSTJUHQbrDsW/dqXDatEalRG5YV/DiJWnal7tSPRZHapyOja3HUpEbZETyxTUsr9m5fxUDexnEbeZmcKnJntohSKjjH2EiW9cNZRKReTL2as2VjF5ZWQTCbWAoAhTMrYEFgZCjDqOcgfD2WVlyYWOTObDFyXbu2ruLZp3I4bvR0PrBIfZMmgJJag+MI9xcqdGY1uS4L12PKRVDedQV6Xoq7riBhRpWh0CbUr3oBkJiMVztmCmU+++oeJ78uMPewgtZmQ0H9Mq247SbFVEdkpMEOHRlNZ9bi+u9/8sWZAnfulYyg4u0sqbW10gtMK8MRxYWB3hSv7RtgbCTL7dkSp795wORULZCb5LhxSxkexN3qRIt+l3ZhZE2Gl/f0ke+2mSmUuHBlqR60KuowCWO7dTUSQyYLSsGDhQrnJ5ZYXnEY6E2xbXMOS9f59lUdV/htpkilKqh2EEjjlTWt1ErDw4UqX54tcPNukXVDGV7Z08fja7NG/Jm05uJPy2TTmhefy5OyVDS72mAuuZd59zu/XGXujwpbxjo5uLuP1X0pXDdURD29TFpx6IV+JqeKnJtYQgRe2hkDZRhdJBGQAZgLbBjO8PahIfLdNl0dOqhDUQVBa83wYJqtm7roW2VzfmIJV2Dfzjwp28CUPxZLK0AxJctSjKxO16qsmyRYO4XrQspWPL8jT38+xZnv5hER9u/qrYNSRtVgNQ/qYGahZSxEVBVs25zj6IHVTN8vc/biAuWKNAxopqUbBEwVrg0w4ZR3HOHqzRXmHpZZ05/i3OVFfvhlOfqGlLDMMWTqO4b+k0optN+7Qr60hlvTRb69tEhn1mLTaJZ8t23sBolZ5r/jKUDiM4uBXldg84YODu8foFIVbFvR020jUpuRdm/r4dZ0EceBIwcG6cpaxmyLh1V0/AgfIKn2h6jo6rDY/mQuAtJP5Z6cxf5dvXx/dTk6bRrsVkPzegDo0rVH7Hg61064RI7nSMxHKBE2rssy1J8mndKNdkPUvPFB/e01COoTJ6dx3RZwDNvKJOPJaa3oyVmNwRwCMzwQfduJNNcj799oeLto1jBNCRife5qNJKWyy963fo76S/p/6PQn48GgHxiTZOMNnceQrf5sXXWEI8fa/Pfj3176n5v4nwP6C3h2+3zWOl3BAAAAAElFTkSuQmCC';

const VOICE_MODE_TRAY_VISUALS = {
  dictation: {
    accent: '#32c7c7',
    pngBase64: DICTATION_TRAY_ICON_PNG,
    tooltip: 'Tro — Write my words',
  },
  task: {
    accent: '#f2c94c',
    pngBase64: TASK_TRAY_ICON_PNG,
    tooltip: 'Tro — Ask Tro',
  },
} as const satisfies Record<
  VoiceMode,
  { accent: string; pngBase64: string; tooltip: string }
>;

interface VoiceModeTrayImageFactory<TImage> {
  createFromBuffer(
    buffer: Buffer,
    options: { scaleFactor: number },
  ): TImage;
}

interface VoiceModeTrayTarget<TImage> {
  setImage(image: TImage): void;
  setToolTip(toolTip: string): void;
}

export function voiceModeTrayVisual(mode: VoiceMode) {
  return VOICE_MODE_TRAY_VISUALS[mode];
}

export function createVoiceModeTrayImage<TImage>(
  imageFactory: VoiceModeTrayImageFactory<TImage>,
  mode: VoiceMode,
): TImage {
  return imageFactory.createFromBuffer(
    Buffer.from(voiceModeTrayVisual(mode).pngBase64, 'base64'),
    { scaleFactor: 2 },
  );
}

export function synchronizeVoiceModeTray<TImage>(
  tray: VoiceModeTrayTarget<TImage>,
  imageFactory: VoiceModeTrayImageFactory<TImage>,
  mode: VoiceMode,
): void {
  tray.setImage(createVoiceModeTrayImage(imageFactory, mode));
  tray.setToolTip(voiceModeTrayVisual(mode).tooltip);
}
