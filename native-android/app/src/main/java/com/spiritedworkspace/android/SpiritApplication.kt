package com.spiritedworkspace.android

import android.app.Application

class SpiritApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    companion object {
        lateinit var instance: SpiritApplication
            private set
    }
}
