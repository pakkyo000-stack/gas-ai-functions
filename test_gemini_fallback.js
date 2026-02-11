function testGeminiFallback() {
    console.log("=== Test 1: Normal Call (Primary Model) ===");
    // Should use default or specified valid model
    try {
        const res1 = gemn("Hello, say 'Test 1 OK'", "", "gemini-3-flash-preview");
        console.log("Result 1:", res1);
    } catch (e) {
        console.error("Test 1 Failed:", e);
    }

    console.log("\n=== Test 2: Fallback Trigger (Invalid Primary) ===");
    // Should fail on 'invalid-model-name' and fallback to gemini-3-flash-preview etc.
    try {
        const res2 = gemn("Hello, say 'Fallback OK'", "", "invalid-model-name");
        console.log("Result 2:", res2);
    } catch (e) {
        console.error("Test 2 Failed:", e);
    }
}
