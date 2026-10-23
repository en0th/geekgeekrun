package io.geekgeekrun.mobile;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MobileBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
