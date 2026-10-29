import { HeadphonesIcon, VideoIcon } from "lucide-react";
import { OrderChatPanelSkeleton } from "../components/LoadingSkeletons.jsx";
import { PageError } from "../components/PageError.jsx";
import { useOrderChatPage } from "../hooks/useOrderChatPage.js";
// import {
//   Chat,
//   Channel,
//   ChannelHeader,
//   MessageList,
//   MessageInput,
//   Thread,
//   Window,
// } from "stream-chat-react";
// import "stream-chat-react/dist/css/v2/index.css";

function OrderChatPage() {
  const { paid, client, error, channel, canInvite, inviteMutation } =
    useOrderChatPage();

  if (!paid) {
    return (
      <p className="text-base-content/60">
        Complete payment to open support chat.
      </p>
    );
  }
  if (error) {
    return <PageError message={error} />;
  }
  if (!client || !channel) {
    return <OrderChatPanelSkeleton />;
  }

  return (
    <div className="space-y-4 text-left">
      <div className="card border border-base-300 bg-base-100 shadow-sm">
        <div className="card-body flex-row flex-wrap items-start gap-4">
          <div className="avatar placeholder">
            <div className="w-12 rounded-box bg-primary/20 text-primary flex items-center justify-center">
              <HeadphonesIcon className="size-6" aria-hidden />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default OrderChatPage;
