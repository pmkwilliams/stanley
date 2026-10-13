import type { AppModule } from '@stanley/app-sdk'
import { emailApp } from '@stanley/app-email/core'
import { lightsApp } from '@stanley/app-lights/core'
import { musicApp } from '@stanley/app-music/core'
import { settingsApp } from '@stanley/app-settings/core'
import { todoApp } from '@stanley/app-todo/core'
import { weatherApp } from '@stanley/app-weather/core'
import { webApp } from '@stanley/app-web/core'

export const apps: AppModule<any>[] = [webApp, emailApp, todoApp, weatherApp, musicApp, lightsApp, settingsApp]
