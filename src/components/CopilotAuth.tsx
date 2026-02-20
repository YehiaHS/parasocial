import { useState, useEffect } from 'react';
import { useChatStore } from '../store/chatStore';
import { Loader2, CheckCircle, ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';

const CLIENT_ID = 'Iv1.b507a08c87ecfe98'; // VS Code Copilot Client ID

export function CopilotAuth({ onClose }: { onClose: () => void }) {
    const { setApiKey } = useChatStore();
    const [userCode, setUserCode] = useState<string | null>(null);
    const [verificationUri, setVerificationUri] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [polling, setPolling] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const initiateAuth = async () => {
        setLoading(true);
        setError(null);
        try {
            const resp = await fetch('/github-oauth/login/device/code', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    client_id: CLIENT_ID,
                    scope: 'read:user'
                })
            });

            if (!resp.ok) throw new Error('Failed to initiate device flow');

            const data = await resp.json();
            setUserCode(data.user_code);
            setVerificationUri(data.verification_uri);

            startPolling(data.device_code, data.interval);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const startPolling = async (dCode: string, interval: number) => {
        setPolling(true);
        const pollInterval = (interval + 1) * 1000;

        const checkToken = async () => {
            try {
                const resp = await fetch('/github-oauth/login/oauth/access_token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({
                        client_id: CLIENT_ID,
                        device_code: dCode,
                        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
                    })
                });

                const data = await resp.json();

                if (data.access_token) {
                    setApiKey(data.access_token);
                    setPolling(false);
                    onClose(); // Close modal on success
                } else if (data.error === 'authorization_pending') {
                    setTimeout(checkToken, pollInterval);
                } else {
                    setError(data.error_description || 'Authentication failed');
                    setPolling(false);
                }
            } catch (err) {
                // Continue polling on network error
                setTimeout(checkToken, pollInterval);
            }
        };

        setTimeout(checkToken, pollInterval);
    };

    // Start immediately on mount
    useEffect(() => {
        initiateAuth();
    }, []);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="glass w-full max-w-md p-8 rounded-2xl border border-white/10 text-center relative"
            >
                <h2 className="text-xl font-serif mb-2">Connect GitHub Copilot</h2>
                <p className="text-sm text-white/50 mb-6">Authorize Parasocial to access your Copilot credits.</p>

                {error && (
                    <div className="bg-red-500/10 text-red-400 p-3 rounded-lg text-xs mb-4">
                        {error}
                        <button onClick={initiateAuth} className="block mt-2 underline">Retry</button>
                    </div>
                )}

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-8">
                        <Loader2 className="w-8 h-8 animate-spin text-white/30" />
                        <span className="text-xs mt-2 opacity-50">Initializing...</span>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                            <div className="text-[10px] uppercase tracking-widest opacity-40 mb-1">Device Code</div>
                            <div className="text-3xl font-mono tracking-widest text-brand-primary selection:bg-white/20">
                                {userCode}
                            </div>
                        </div>

                        <div className="text-sm opacity-60">
                            1. Copy the code above<br />
                            2. Go to <a href={verificationUri || '#'} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-1">GitHub Activation <ExternalLink className="w-3 h-3" /></a><br />
                            3. Paste the code and authorize
                        </div>

                        <div className="flex items-center justify-center gap-2 text-xs opacity-40 animate-pulse">
                            {polling ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                            {polling ? 'Waiting for authorization...' : 'Done'}
                        </div>
                    </div>
                )}

                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-white/20 hover:text-white transition-colors"
                >
                    ✕
                </button>
            </motion.div>
        </div>
    );
}
